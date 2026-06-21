/**
 * 로컬 대중교통 라우터
 *
 * 전처리된 그래프(data/transit-graph.json)를 로드하고, 출발지에서
 * "최대 k회 환승, n분 이내" 도달 가능한 정류장을 RAPTOR로 탐색.
 *
 * RAPTOR(라운드 기반): 라운드 r = 탑승 r회로 도달 가능 ⇒ 환승 = 탑승−1.
 * 노선 단위로 한 번에 스캔하므로 "환승 횟수"를 정확히 제한할 수 있다.
 *
 * API 호출 없음. 완전 오프라인 동작.
 */

const WALK_SPEED_MPM  = 80;    // 도보 속도 (m/분)
const MAX_WALK_ORIGIN = 1000;  // 출발지에서 첫 정류장까지 최대 도보 거리 (m)
const EGRESS_WALK_M   = 1000;  // 정류장 하차 후 최대 도보 거리 (m)
const MAX_TRANSFER_M  = 350;   // 정류장 간 도보 환승 허용 거리 (m)

let graphCache  = null; // 그래프(JSON)
let stopRoutes  = null; // stopRoutes[stop] = [routeId...]  (정류장을 지나는 노선)
let footpaths   = null; // footpaths[stop]  = [[toStop, walkSec]...]  (도보 환승)

/**
 * 그래프 파일 로드 (최초 1회만 fetch) + 라우팅 인덱스 구축
 */
export async function loadGraph(graphUrl = 'data/transit-graph.json') {
  if (graphCache) return graphCache;

  const res = await fetch(graphUrl);
  if (!res.ok) throw new Error(
    `그래프 파일을 찾을 수 없습니다 (${res.status}).\n` +
    'node scripts/build-from-pbf.js 를 먼저 실행해 data/transit-graph.json 을 만드세요.'
  );

  const g = await res.json();
  if (!g.routes) throw new Error('오래된 그래프 형식입니다. node scripts/build-from-pbf.js 로 다시 빌드하세요.');

  graphCache = g;
  stopRoutes = buildStopRoutes(g);   // 정류장 → 노선 인덱스
  footpaths  = buildFootpaths(g);    // 350m 이내 도보 환승

  console.log(`[transit] 로드 완료: 정류장 ${g.lat.length}, 노선 ${g.routes.length}`);
  return g;
}

/**
 * 출발지에서 maxMinutes 이내 · 최대 maxTransfers회 환승으로 도달 가능한 정류장
 *
 * @param {{ lat, lng }} origin
 * @param {number} maxMinutes
 * @param {number} maxTransfers  최대 환승 횟수 (0,1,2,...)
 * @returns {{ stopIdx, timeSec }[]}
 */
export function findReachable(origin, maxMinutes, maxTransfers = 2) {
  if (!graphCache) throw new Error('그래프가 로드되지 않았습니다.');

  const g      = graphCache;
  const n      = g.lat.length;
  const maxSec = maxMinutes * 60;
  const INF    = Infinity;

  const arr = new Float64Array(n).fill(INF); // 정류장별 최소 도달 시간
  let marked = new Set();

  // ── 시드: 출발지 도보권 정류장 (탑승 0회) ──────────────────
  for (let i = 0; i < n; i++) {
    const m = haversineMeters(origin.lat, origin.lng, g.lat[i], g.lng[i]);
    if (m <= MAX_WALK_ORIGIN) {
      const t = Math.round((m / WALK_SPEED_MPM) * 60);
      if (t <= maxSec) { arr[i] = t; marked.add(i); }
    }
  }
  if (marked.size === 0) return [];

  // 출발지 도보권 정류장끼리의 환승(footpath)도 0라운드에 반영
  relaxFootpaths(arr, marked, maxSec);

  // ── 라운드 = 탑승 횟수: maxTransfers + 1 번 ────────────────
  const rounds = maxTransfers + 1;
  for (let k = 0; k < rounds; k++) {
    const prev = arr.slice();         // 이번 라운드 탑승 기준 시각
    const newlyMarked = new Set();

    // marked 정류장을 지나는 노선만 스캔
    const routeSet = new Set();
    for (const s of marked) {
      const rs = stopRoutes[s];
      if (rs) for (const rid of rs) routeSet.add(rid);
    }

    for (const rid of routeSet) {
      scanRoute(rid, prev, arr, newlyMarked, maxSec, +1); // 정방향
      scanRoute(rid, prev, arr, newlyMarked, maxSec, -1); // 역방향
    }

    // 도보 환승 (탑승 아님 → 라운드 소모 X)
    relaxFootpaths(arr, newlyMarked, maxSec);

    marked = newlyMarked;
    if (marked.size === 0) break;
  }

  const result = [];
  for (let i = 0; i < n; i++) if (arr[i] !== INF) result.push({ stopIdx: i, timeSec: arr[i] });
  return result;
}

/**
 * 한 노선을 한 방향으로 스캔하며 하차 시각을 갱신 (RAPTOR 한 트립).
 * dir = +1 정방향, -1 역방향.
 */
function scanRoute(rid, prev, arr, newlyMarked, maxSec, dir) {
  const route = graphCache.routes[rid];
  const s = route.s, t = route.t;     // 정류장 순서, 구간시간
  const L = s.length;

  // 누적 시간(cum)을 진행 방향으로 계산하며 "가장 이른 탑승" 추적.
  // 하차시각 = bestOffset + cum, 이때 bestOffset = min(prev[stop] - cum).
  let bestOffset = Infinity;
  let cum = 0;

  for (let step = 0; step < L; step++) {
    const i  = dir === 1 ? step : L - 1 - step;
    const st = s[i];

    if (step > 0) {
      // 직전 정류장 → 현재 정류장 구간시간 더하기
      const segIdx = dir === 1 ? i - 1 : i; // 정방향: t[i-1], 역방향: t[i]
      cum += t[segIdx];
    }

    // 이미 탑승한 상태라면 이 정류장에 하차 가능
    if (bestOffset !== Infinity) {
      const cand = bestOffset + cum;
      if (cand <= maxSec && cand < arr[st]) {
        arr[st] = cand;
        newlyMarked.add(st);
      }
    }

    // 이 정류장에서 (더 이르게) 탑승 가능한지
    const p = prev[st];
    if (p !== Infinity && p - cum < bestOffset) bestOffset = p - cum;
  }
}

/** marked 정류장들에서 350m 도보 환승으로 인접 정류장 갱신 */
function relaxFootpaths(arr, marked, maxSec) {
  for (const s of [...marked]) {
    const fps = footpaths[s];
    if (!fps) continue;
    for (const [to, w] of fps) {
      const nd = arr[s] + w;
      if (nd <= maxSec && nd < arr[to]) {
        arr[to] = nd;
        marked.add(to);
      }
    }
  }
}

/**
 * 시간장(time field) 계산 — 슬라이더와 무관하게 출발지당 1회만 수행
 *
 * 격자의 각 셀에 "그 지점까지 도달하는 최소 시간(초)"을 기록한다.
 *   셀 시간 = min( 출발지 직접 도보, 각 정류장 도달시간 + 정류장→셀 도보 )
 * 이 시간장에서 임의의 분(level)에 대한 등시간선을 즉시 뽑을 수 있다.
 *
 * @param {{ lat, lng }} origin
 * @param {{ stopIdx, timeSec }[]} reachable
 * @param {{ cellM?: number }} opts   cellM: 격자 한 칸 크기(m), 작을수록 정밀
 * @returns {object} field
 */
export function computeTimeField(origin, reachable, opts = {}) {
  if (!graphCache) return null;
  const g     = graphCache;
  const cellM = opts.cellM ?? 250;

  // 영역(bbox): 도달 정류장 + 도보 여유
  let minLa = origin.lat, maxLa = origin.lat, minLn = origin.lng, maxLn = origin.lng;
  for (const { stopIdx } of reachable) {
    const la = g.lat[stopIdx], ln = g.lng[stopIdx];
    if (la < minLa) minLa = la; if (la > maxLa) maxLa = la;
    if (ln < minLn) minLn = ln; if (ln > maxLn) maxLn = ln;
  }
  const cosLat     = Math.cos(origin.lat * Math.PI / 180);
  const latPerCell = cellM / 111000;
  const lngPerCell = cellM / (111000 * cosLat);
  const marginR    = Math.ceil(EGRESS_WALK_M / cellM) + 1;

  minLa -= marginR * latPerCell; maxLa += marginR * latPerCell;
  minLn -= marginR * lngPerCell; maxLn += marginR * lngPerCell;

  const rows = Math.ceil((maxLa - minLa) / latPerCell) + 1;
  const cols = Math.ceil((maxLn - minLn) / lngPerCell) + 1;
  const time = new Float32Array(rows * cols).fill(Infinity);

  const cellLat = r => minLa + r * latPerCell;
  const cellLng = c => minLn + c * lngPerCell;

  // 한 지점(la,ln)에서 반경 EGRESS_WALK_M 안의 셀에 (baseSec + 도보시간) 칠하기 (최솟값)
  function paint(la, ln, baseSec) {
    const r0 = Math.round((la - minLa) / latPerCell);
    const c0 = Math.round((ln - minLn) / lngPerCell);
    for (let dr = -marginR; dr <= marginR; dr++) {
      const r = r0 + dr; if (r < 0 || r >= rows) continue;
      for (let dc = -marginR; dc <= marginR; dc++) {
        const c = c0 + dc; if (c < 0 || c >= cols) continue;
        const dM = haversineMeters(la, ln, cellLat(r), cellLng(c));
        if (dM > EGRESS_WALK_M) continue;
        const t = baseSec + (dM / WALK_SPEED_MPM) * 60;
        const id = r * cols + c;
        if (t < time[id]) time[id] = t;
      }
    }
  }

  paint(origin.lat, origin.lng, 0); // 출발지에서 직접 도보
  for (const { stopIdx, timeSec } of reachable) {
    paint(g.lat[stopIdx], g.lng[stopIdx], timeSec);
  }

  return { time, rows, cols, minLa, minLn, latPerCell, lngPerCell };
}

// 마칭 스퀘어 세그먼트 테이블 (셀 모서리: T/R/B/L)
const MS_SEGS = {
  0:[],            1:[['L','T']],   2:[['T','R']],   3:[['L','R']],
  4:[['R','B']],   5:[['L','T'],['R','B']], 6:[['T','B']], 7:[['L','B']],
  8:[['L','B']],   9:[['T','B']],   10:[['T','R'],['L','B']], 11:[['R','B']],
  12:[['L','R']],  13:[['T','R']],  14:[['L','T']],  15:[],
};

/**
 * 시간장에서 level분 등시간선 폴리곤(들) 추출 — 마칭 스퀘어
 * 슬라이더 값마다 호출(빠름). 오목한 모양·분리된 구역도 정확히 표현.
 *
 * @param {object} field   computeTimeField 결과
 * @param {number} levelMin 기준 시간(분)
 * @returns {Array<Array<{lat,lng}>>}  폴리곤 링 배열
 */
export function extractContour(field, levelMin) {
  if (!field) return [];
  const { time, rows, cols, minLa, minLn, latPerCell, lngPerCell } = field;
  const level = levelMin * 60;

  const coords = new Map();           // key → { row, col } (격자 좌표, 반칸 단위)
  const adj    = new Map();           // key → [{ nKey, eId }]
  let eId = 0;

  const ptKey = (row, col) => {
    const pr = Math.round(row * 2), pc = Math.round(col * 2);
    const key = pr + ',' + pc;
    if (!coords.has(key)) coords.set(key, { row: pr / 2, col: pc / 2 });
    return key;
  };
  const edgePt = (r, c, e) =>
    e === 'T' ? ptKey(r, c + 0.5) :
    e === 'R' ? ptKey(r + 0.5, c + 1) :
    e === 'B' ? ptKey(r + 1, c + 0.5) :
                ptKey(r + 0.5, c);
  const addAdj = (a, b, id) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ nKey: b, eId: id });
  };

  const inside = id => time[id] <= level; // Infinity는 항상 바깥

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      let cs = 0;
      if (inside(r * cols + c))             cs |= 1; // TL
      if (inside(r * cols + c + 1))         cs |= 2; // TR
      if (inside((r + 1) * cols + c + 1))   cs |= 4; // BR
      if (inside((r + 1) * cols + c))       cs |= 8; // BL
      if (cs === 0 || cs === 15) continue;
      for (const [e1, e2] of MS_SEGS[cs]) {
        const a = edgePt(r, c, e1), b = edgePt(r, c, e2);
        addAdj(a, b, eId); addAdj(b, a, eId); eId++;
      }
    }
  }

  // 세그먼트를 닫힌 링으로 연결
  const used  = new Set();
  const rings = [];
  for (const [startKey, list] of adj) {
    for (const e0 of list) {
      if (used.has(e0.eId)) continue;
      used.add(e0.eId);
      const ringKeys = [startKey];
      let cur = e0.nKey;
      while (cur !== startKey) {
        ringKeys.push(cur);
        const nbrs = adj.get(cur) || [];
        let nxt = null;
        for (const e of nbrs) { if (!used.has(e.eId)) { nxt = e; break; } }
        if (!nxt) break;
        used.add(nxt.eId);
        cur = nxt.nKey;
      }
      if (ringKeys.length >= 3) {
        rings.push(ringKeys.map(k => {
          const p = coords.get(k);
          return { lat: minLa + p.row * latPerCell, lng: minLn + p.col * lngPerCell };
        }));
      }
    }
  }
  return rings;
}

// ── 라우팅 인덱스 구축 ─────────────────────────────────────────

/** 정류장 → 그 정류장을 지나는 노선 ID 목록 */
function buildStopRoutes(g) {
  const idx = Array.from({ length: g.lat.length }, () => null);
  for (let rid = 0; rid < g.routes.length; rid++) {
    for (const st of g.routes[rid].s) {
      (idx[st] || (idx[st] = [])).push(rid);
    }
  }
  return idx;
}

/** 350m 이내 정류장끼리 도보 환승 인접 리스트 (그리드 가속) */
function buildFootpaths(g) {
  const n   = g.lat.length;
  const foot = Array.from({ length: n }, () => null);
  const cellDeg = (MAX_TRANSFER_M / 111000) * 1.5;
  const grid = new Map();

  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(g.lng[i] / cellDeg)},${Math.floor(g.lat[i] / cellDeg)}`;
    (grid.get(k) || grid.set(k, []).get(k)).push(i);
  }
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(g.lng[i] / cellDeg);
    const cy = Math.floor(g.lat[i] / cellDeg);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          const m = haversineMeters(g.lat[i], g.lng[i], g.lat[j], g.lng[j]);
          if (m <= MAX_TRANSFER_M) {
            const sec = Math.round((m / WALK_SPEED_MPM) * 60);
            (foot[i] || (foot[i] = [])).push([j, sec]);
            (foot[j] || (foot[j] = [])).push([i, sec]);
          }
        }
      }
    }
  }
  return foot;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const d1 = (lat2 - lat1) * Math.PI / 180;
  const d2 = (lng2 - lng1) * Math.PI / 180;
  const a  =
    Math.sin(d1 / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(d2 / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
