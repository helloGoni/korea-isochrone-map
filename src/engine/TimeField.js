/**
 * 시간장(time field) — 격자의 각 칸까지 최소 도달 시간(초)
 *
 *   칸 시간 = min( 출발지 직접 도보, 각 정류장 도달시간 + 정류장→칸 도보 )
 *
 * 출발지당 1회만 만들고, 슬라이더 값마다 contour(분)으로 등고선만 즉시 뽑는다.
 */

import { haversineMeters, walkSeconds } from './geo.js';

// 마칭 스퀘어 세그먼트 테이블 (셀 모서리: T/R/B/L)
const MS_SEGS = {
  0:[],            1:[['L','T']],   2:[['T','R']],   3:[['L','R']],
  4:[['R','B']],   5:[['L','T'],['R','B']], 6:[['T','B']], 7:[['L','B']],
  8:[['L','B']],   9:[['T','B']],   10:[['T','R'],['L','B']], 11:[['R','B']],
  12:[['L','R']],  13:[['T','R']],  14:[['L','T']],  15:[],
};

export class TimeField {
  constructor({ time, rows, cols, minLa, minLn, latPerCell, lngPerCell }) {
    Object.assign(this, { time, rows, cols, minLa, minLn, latPerCell, lngPerCell });
  }

  /**
   * @param {import('./TransitNetwork.js').TransitNetwork} network
   * @param {{ lat, lng }} origin
   * @param {{ stopIdx, timeSec }[]} reachable  RaptorRouter.findReachable 결과
   * @param {{ cellM?: number, egressWalkM?: number }} opts
   *        cellM: 격자 한 칸 크기(m, 작을수록 정밀) · egressWalkM: 하차 후 최대 도보 거리(m)
   */
  static build(network, origin, reachable, { cellM = 100, egressWalkM = 1000 } = {}) {
    const { lat, lng } = network;

    // 영역(bbox): 도달 정류장 + 도보 여유
    let minLa = origin.lat, maxLa = origin.lat, minLn = origin.lng, maxLn = origin.lng;
    for (const { stopIdx } of reachable) {
      const la = lat[stopIdx], ln = lng[stopIdx];
      if (la < minLa) minLa = la; if (la > maxLa) maxLa = la;
      if (ln < minLn) minLn = ln; if (ln > maxLn) maxLn = ln;
    }
    const cosLat     = Math.cos(origin.lat * Math.PI / 180);
    const latPerCell = cellM / 111000;
    const lngPerCell = cellM / (111000 * cosLat);
    const marginR    = Math.ceil(egressWalkM / cellM) + 1;

    minLa -= marginR * latPerCell; maxLa += marginR * latPerCell;
    minLn -= marginR * lngPerCell; maxLn += marginR * lngPerCell;

    const rows = Math.ceil((maxLa - minLa) / latPerCell) + 1;
    const cols = Math.ceil((maxLn - minLn) / lngPerCell) + 1;
    const time = new Float32Array(rows * cols).fill(Infinity);

    // 한 지점에서 반경 egressWalkM 안의 칸에 (baseSec + 도보시간) 칠하기 (최솟값)
    const paint = (la, ln, baseSec) => {
      const r0 = Math.round((la - minLa) / latPerCell);
      const c0 = Math.round((ln - minLn) / lngPerCell);
      for (let dr = -marginR; dr <= marginR; dr++) {
        const r = r0 + dr; if (r < 0 || r >= rows) continue;
        for (let dc = -marginR; dc <= marginR; dc++) {
          const c = c0 + dc; if (c < 0 || c >= cols) continue;
          const dM = haversineMeters(la, ln, minLa + r * latPerCell, minLn + c * lngPerCell);
          if (dM > egressWalkM) continue;
          const t  = baseSec + walkSeconds(dM);
          const id = r * cols + c;
          if (t < time[id]) time[id] = t;
        }
      }
    };

    paint(origin.lat, origin.lng, 0); // 출발지에서 직접 도보
    for (const { stopIdx, timeSec } of reachable) paint(lat[stopIdx], lng[stopIdx], timeSec);

    return new TimeField({ time, rows, cols, minLa, minLn, latPerCell, lngPerCell });
  }

  /**
   * level분 등시간선 폴리곤(들) 추출 — 마칭 스퀘어.
   * 오목한 모양·분리된 구역·홀까지 표현.
   * @returns {Array<Array<{lat,lng}>>} 폴리곤 링 배열
   */
  contour(levelMin) {
    const { time, rows, cols, minLa, minLn, latPerCell, lngPerCell } = this;
    const level = levelMin * 60;

    const coords = new Map(); // key → { row, col } (격자 좌표, 반칸 단위)
    const adj    = new Map(); // key → [{ nKey, eId }]
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
        if (inside(r * cols + c))           cs |= 1; // TL
        if (inside(r * cols + c + 1))       cs |= 2; // TR
        if (inside((r + 1) * cols + c + 1)) cs |= 4; // BR
        if (inside((r + 1) * cols + c))     cs |= 8; // BL
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
          const nxt = (adj.get(cur) || []).find(e => !used.has(e.eId));
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
}
