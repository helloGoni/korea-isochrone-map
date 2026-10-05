/**
 * RAPTOR 라우터 — "최대 k회 환승, n분 이내" 도달 가능한 정류장 탐색
 *
 * 라운드 r = 탑승 r회로 도달 가능 ⇒ 환승 = 탑승−1.
 * 노선 단위로 한 번에 스캔하므로 환승 횟수를 정확히 제한할 수 있다.
 * API 호출 없음. 완전 오프라인 동작.
 */

import { walkSeconds } from './geo.js';

export class RaptorRouter {
  /**
   * @param {import('./TransitNetwork.js').TransitNetwork} network  finalize() 된 네트워크
   * @param {{ maxOriginWalkM?: number }} opts  출발지 → 첫 정류장 최대 도보 거리(m)
   */
  constructor(network, { maxOriginWalkM = 1000 } = {}) {
    if (!network.isReady) throw new Error('네트워크 인덱스가 없습니다. finalize()를 먼저 호출하세요.');
    this.net = network;
    this.maxOriginWalkM = maxOriginWalkM;
  }

  /**
   * @param {{ lat, lng }} origin
   * @param {{ maxMinutes: number, maxTransfers?: number }} opts
   * @returns {{ stopIdx: number, timeSec: number }[]}
   */
  findReachable(origin, { maxMinutes, maxTransfers = 2 }) {
    const n      = this.net.stopCount;
    const maxSec = maxMinutes * 60;
    const arr    = new Float64Array(n).fill(Infinity); // 정류장별 최소 도달 시간
    let marked   = new Set();

    // ── 시드: 출발지 도보권 정류장 (탑승 0회) ──────────────────
    for (const [i, m] of this.net.stopsWithin(origin.lat, origin.lng, this.maxOriginWalkM)) {
      const t = Math.round(walkSeconds(m));
      if (t <= maxSec) { arr[i] = t; marked.add(i); }
    }
    if (marked.size === 0) return [];

    // 출발지 도보권 정류장끼리의 환승도 0라운드에 반영
    this.#relaxFootpaths(arr, marked, maxSec);

    // ── 라운드 = 탑승 횟수: maxTransfers + 1 번 ────────────────
    for (let k = 0; k < maxTransfers + 1; k++) {
      const prev = arr.slice();       // 이번 라운드 탑승 기준 시각
      const newlyMarked = new Set();

      // marked 정류장을 지나는 노선만 스캔
      const routeSet = new Set();
      for (const s of marked) {
        const rs = this.net.stopRoutes[s];
        if (rs) for (const rid of rs) routeSet.add(rid);
      }
      for (const rid of routeSet) {
        this.#scanRoute(rid, prev, arr, newlyMarked, maxSec, +1); // 정방향
        this.#scanRoute(rid, prev, arr, newlyMarked, maxSec, -1); // 역방향
      }

      // 도보 환승 (탑승 아님 → 라운드 소모 X)
      this.#relaxFootpaths(arr, newlyMarked, maxSec);

      marked = newlyMarked;
      if (marked.size === 0) break;
    }

    const result = [];
    for (let i = 0; i < n; i++) if (arr[i] !== Infinity) result.push({ stopIdx: i, timeSec: arr[i] });
    return result;
  }

  /**
   * 한 노선을 한 방향으로 스캔하며 하차 시각을 갱신 (RAPTOR 한 트립).
   * 하차시각 = bestOffset + cum, 이때 bestOffset = min(prev[stop] - cum).
   */
  #scanRoute(rid, prev, arr, newlyMarked, maxSec, dir) {
    const { s, t } = this.net.routes[rid];
    const L = s.length;
    let bestOffset = Infinity;
    let cum = 0;

    for (let step = 0; step < L; step++) {
      const i  = dir === 1 ? step : L - 1 - step;
      const st = s[i];

      if (step > 0) cum += t[dir === 1 ? i - 1 : i]; // 직전 → 현재 구간시간

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

  /** marked 정류장들에서 도보 환승으로 인접 정류장 갱신 */
  #relaxFootpaths(arr, marked, maxSec) {
    for (const s of [...marked]) {
      const fps = this.net.footpaths[s];
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
}
