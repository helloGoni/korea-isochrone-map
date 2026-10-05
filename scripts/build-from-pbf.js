/**
 * Geofabrik OSM PBF → 대중교통 라우팅 그래프 빌드
 *
 * API 호출/제한 없음. 파일 하나를 받아 로컬에서 파싱합니다.
 *
 * 사용법:
 *   node scripts/build-from-pbf.js
 *     → data/south-korea-latest.osm.pbf 가 없으면 Geofabrik에서 자동 다운로드
 *     → 있으면 그 파일을 그대로 사용
 *
 *   node scripts/build-from-pbf.js path/to/region.osm.pbf
 *     → 직접 받은 PBF 파일 지정 (예: Geofabrik의 다른 지역 추출본)
 *
 * 출력: data/transit-graph.json
 *
 * Geofabrik 한국 데이터: https://download.geofabrik.de/asia/south-korea.html
 */

const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const parseOSM  = require('osm-pbf-parser');
const through   = require('through2');

// ── 설정 ─────────────────────────────────────────────────────
const PBF_URL  = 'https://download.geofabrik.de/asia/south-korea-latest.osm.pbf';
const DATA_DIR = path.join(__dirname, '..', 'data');
const PBF_PATH = path.join(DATA_DIR, 'south-korea-latest.osm.pbf');
const OUT_PATH = path.join(DATA_DIR, 'transit-graph.json');

const WALK_SPEED_MPM = 80;    // 도보 m/분
const MAX_TRANSFER_M = 350;   // 환승 허용 거리 m
const ROUTE_TYPES    = new Set(['subway', 'light_rail', 'bus', 'tram', 'trolleybus']);

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const customPath = process.argv[2];
  const pbfPath    = customPath || PBF_PATH;

  console.log('='.repeat(58));
  console.log('대중교통 그래프 빌드 — Geofabrik OSM PBF (오프라인)');
  console.log('='.repeat(58) + '\n');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // 0. PBF 파일 확보 (이어받기 지원)
  if (customPath) {
    if (!fs.existsSync(customPath)) {
      console.error(`파일을 찾을 수 없습니다: ${customPath}`);
      process.exit(1);
    }
    const mb = (fs.statSync(customPath).size / 1024 / 1024).toFixed(0);
    console.log(`[0/3] 지정한 PBF 사용: ${customPath} (${mb}MB)\n`);
  } else {
    await ensurePbf(PBF_URL, pbfPath);
    console.log();
  }

  // 1. Pass 1 — 대중교통 노선(relation)에서 정류장 순서 + 필요한 node ID 수집
  console.log('[1/3] Pass 1: 노선(relation) 파싱 — 정류장 순서 수집...');
  const { routes, neededNodeIds } = await pass1Relations(pbfPath);
  console.log(`   ✅ 대중교통 노선 ${routes.length}개, 참조 정류장 ${neededNodeIds.size}개\n`);

  // 2. Pass 2 — 필요한 node의 좌표만 수집
  console.log('[2/3] Pass 2: 정류장 좌표 수집...');
  const nodeCoords = await pass2Nodes(pbfPath, neededNodeIds);
  console.log(`   ✅ 좌표 확보 ${nodeCoords.size}개\n`);

  // 3. 그래프 구성 + 저장
  console.log('[3/3] 그래프 구성 및 저장...');
  const graph = buildGraph(routes, nodeCoords);
  fs.writeFileSync(OUT_PATH, JSON.stringify(graph));
  const sizeMB = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1);

  console.log('\n' + '='.repeat(58));
  console.log('✅ 완료!');
  console.log(`   파일:   ${OUT_PATH} (${sizeMB} MB)`);
  console.log(`   정류장: ${graph.lat.length.toLocaleString()}개`);
  console.log(`   노선:   ${graph.routes.length.toLocaleString()}개`);
  console.log(`   구간:   ${graph.meta.segments.toLocaleString()}개`);
  console.log(`   수단별: ${JSON.stringify(graph.meta.modes)}`);
  console.log('='.repeat(58));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── PBF 확보 (이어받기) ───────────────────────────────────────

/**
 * 원격 파일 전체 크기 조회 (HEAD, 리다이렉트 추적)
 */
function getRemoteSize(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('리다이렉트 과다')); return; }
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'KoreaIsochroneMap/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return getRemoteSize(res.headers.location, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HEAD 실패: HTTP ${res.statusCode}`)); return; }
      resolve(parseInt(res.headers['content-length'] || '0', 10));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 완전한 PBF 파일을 보장. 일부만 받아져 있으면 이어받기.
 */
async function ensurePbf(url, dest) {
  const total = await getRemoteSize(url).catch(() => 0);
  const have  = fs.existsSync(dest) ? fs.statSync(dest).size : 0;

  if (total && have === total) {
    console.log(`[0/3] 이미 완전한 PBF 보유: ${dest} (${(have/1024/1024).toFixed(0)}MB)`);
    return;
  }
  if (have > 0 && total && have < total) {
    console.log(`[0/3] 일부만 받아져 있음 (${(have/1024/1024).toFixed(0)}/${(total/1024/1024).toFixed(0)}MB) — 이어받기`);
  } else {
    console.log(`[0/3] Geofabrik에서 다운로드 (${total ? (total/1024/1024).toFixed(0)+'MB' : '~250MB'})...`);
    if (have > 0) fs.unlinkSync(dest); // total을 못 구했는데 부분 파일이 있으면 새로 받음
  }

  // 끊겨도 재시도하며 이어받기
  for (let attempt = 0; attempt < 10; attempt++) {
    const startAt = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (total && startAt >= total) break;
    try {
      await downloadRange(url, dest, startAt, total);
      const now = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      if (!total || now >= total) break;
    } catch (e) {
      process.stdout.write(`\n   (중단: ${e.message}, 5초 후 이어받기) `);
      await sleep(5000);
    }
  }
  process.stdout.write('\n');
}

/**
 * Range 헤더로 startAt 바이트부터 이어받아 dest에 append
 */
function downloadRange(url, dest, startAt, total, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('리다이렉트 과다')); return; }

    const headers = { 'User-Agent': 'KoreaIsochroneMap/1.0' };
    if (startAt > 0) headers.Range = `bytes=${startAt}-`;

    https.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadRange(res.headers.location, dest, startAt, total, redirects + 1).then(resolve, reject);
      }
      // 200(처음부터) 또는 206(부분) 만 허용
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      // 206이 아니면 처음부터 다시 (append 아님)
      const append = res.statusCode === 206 && startAt > 0;
      const file   = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });

      let received = append ? startAt : 0;
      let lastPct  = -1;

      res.on('data', chunk => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            process.stdout.write(`\r   다운로드 ${pct}% (${(received/1024/1024).toFixed(0)}/${(total/1024/1024).toFixed(0)}MB)`);
            lastPct = pct;
          }
        }
      });

      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

// ── Pass 1: relation ──────────────────────────────────────────

function pass1Relations(pbfPath) {
  return new Promise((resolve, reject) => {
    const routes        = [];           // [{ type, name, stopNodeIds: [...] }]
    const neededNodeIds = new Set();

    fs.createReadStream(pbfPath)
      .pipe(parseOSM())
      .pipe(through.obj((items, enc, next) => {
        for (const item of items) {
          if (item.type !== 'relation') continue;
          const routeType = item.tags?.route;
          if (!ROUTE_TYPES.has(routeType)) continue;

          // 정류장 역할(node, role이 'stop'으로 시작)만 순서대로
          const stopNodeIds = [];
          for (const m of item.members || []) {
            // osm-pbf-parser는 참조 id를 m.id 로 제공 (m.ref 아님)
            const ref = m.id ?? m.ref;
            if (ref != null && m.type === 'node' && (m.role?.startsWith('stop') || m.role === '')) {
              stopNodeIds.push(ref);
              neededNodeIds.add(ref);
            }
          }
          if (stopNodeIds.length >= 2) {
            routes.push({ type: routeType, name: item.tags?.ref || item.tags?.name || '', stopNodeIds });
          }
        }
        next();
      }))
      .on('finish', () => resolve({ routes, neededNodeIds }))
      .on('error', reject);
  });
}

// ── Pass 2: node 좌표 ─────────────────────────────────────────

function pass2Nodes(pbfPath, neededNodeIds) {
  return new Promise((resolve, reject) => {
    const coords = new Map(); // nodeId → { lat, lon, name }

    fs.createReadStream(pbfPath)
      .pipe(parseOSM())
      .pipe(through.obj((items, enc, next) => {
        for (const item of items) {
          if (item.type !== 'node') continue;
          if (!neededNodeIds.has(item.id)) continue;
          coords.set(item.id, {
            lat:  item.lat,
            lon:  item.lon,
            name: item.tags?.name || item.tags?.['name:ko'] || '',
          });
        }
        next();
      }))
      .on('finish', () => resolve(coords))
      .on('error', reject);
  });
}

// ── 그래프 구성 ───────────────────────────────────────────────

function buildGraph(routes, nodeCoords) {
  const stopIndex = new Map(); // nodeId → 배열 인덱스
  const lat = [], lng = [], name = [];
  const outRoutes = [];        // [{ s:[stopIdx...], t:[segSec...], mode, name }]

  function getOrAdd(nodeId) {
    if (stopIndex.has(nodeId)) return stopIndex.get(nodeId);
    const c = nodeCoords.get(nodeId);
    if (!c) return -1;
    const idx = lat.length;
    stopIndex.set(nodeId, idx);
    lat.push(c.lat); lng.push(c.lon); name.push(c.name);
    return idx;
  }

  for (const route of routes) {
    const isRail   = route.type === 'subway' || route.type === 'light_rail' || route.type === 'tram';
    const speedMpm = isRail ? 583 : 333; // 지하철 35km/h, 버스 20km/h

    // 노선의 정류장 순서와 구간 이동시간을 보존 (RAPTOR 라우팅용)
    const s = [], t = [];
    for (const nodeId of route.stopNodeIds) {
      const idx = getOrAdd(nodeId);
      if (idx < 0) continue;
      if (s.length && s[s.length - 1] === idx) continue; // 연속 중복 제거
      if (s.length) {
        const a = s[s.length - 1];
        const distM = haversineMeters(lat[a], lng[a], lat[idx], lng[idx]);
        let dur = Math.round((distM / speedMpm) * 60);
        dur = Math.max(10, Math.min(3600, dur)); // 클램프(노선 연속성 유지)
        t.push(dur);
      }
      s.push(idx);
    }
    // mode: 화면의 수단별 노선 수 안내용 (OSM route 태그 그대로: subway / bus / light_rail ...)
    if (s.length >= 2) outRoutes.push({ s, t, mode: route.type, name: route.name });
  }

  let segments = 0;
  const modes  = {};
  for (const r of outRoutes) {
    segments += r.t.length;
    modes[r.mode] = (modes[r.mode] || 0) + 1;
  }

  return {
    meta: {
      built:    new Date().toISOString(),
      source:   'Geofabrik OSM PBF',
      stops:    lat.length,
      routes:   outRoutes.length,
      segments,
      modes,
    },
    lat, lng, name,
    routes: outRoutes,   // 도보 환승(footpath)은 로드 시 런타임에서 계산
  };
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const d1 = (lat2 - lat1) * Math.PI / 180;
  const d2 = (lng2 - lng1) * Math.PI / 180;
  const a  =
    Math.sin(d1/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(d2/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

main().catch(e => { console.error('\n❌ 오류:', e.message); process.exit(1); });
