/**
 * 등시간선 엔진 — 네트워크 로드 + RAPTOR + 시간장을 하나로 묶은 진입점
 *
 *   const engine = new IsochroneEngine({ manifestUrl: 'data/sources.json' });
 *   await engine.load();
 *   const result = engine.compute(origin, { maxTransfers: 2 });
 *   result.field.contour(60);   // 60분 등시간선 링 배열
 */

import { loadNetwork } from '../sources/index.js';
import { RaptorRouter } from './RaptorRouter.js';
import { TimeField } from './TimeField.js';

export class IsochroneEngine {
  /**
   * @param {object} opts
   * @param {string} opts.manifestUrl  데이터 소스 목록 파일 (data/sources.json)
   * @param {number} [opts.maxMinutes] 탐색 최대 시간(분)
   * @param {number} [opts.cellM]      격자 한 칸 크기(m)
   */
  constructor({ manifestUrl, maxMinutes = 120, cellM = 100 }) {
    this.manifestUrl = manifestUrl;
    this.maxMinutes  = maxMinutes;
    this.cellM       = cellM;
    this.network     = null;
    this.router      = null;
    this.loading     = null;
  }

  /** 모든 데이터 소스를 읽어 네트워크 구성 (여러 번 불러도 1회만 로드) */
  load() {
    this.loading ??= loadNetwork(this.manifestUrl).then(network => {
      this.network = network;
      this.router  = new RaptorRouter(network);
      console.log(`[transit] 로드 완료: 정류장 ${network.stopCount}, 노선 ${network.routeCount}`);
      return network;
    }).catch(e => { this.loading = null; throw e; });
    return this.loading;
  }

  /**
   * 출발지 기준 시간장 계산
   * @returns {{ field: TimeField, reachableCount: number }}
   */
  compute(origin, { maxTransfers = 2 } = {}) {
    if (!this.router) throw new Error('데이터가 아직 로드되지 않았습니다.');
    const reachable = this.router.findReachable(origin, { maxMinutes: this.maxMinutes, maxTransfers });
    const field     = TimeField.build(this.network, origin, reachable, { cellM: this.cellM });
    return { field, reachableCount: reachable.length };
  }
}
