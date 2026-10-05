/**
 * type: "graph-json" — scripts/build-from-pbf.js 가 만든 압축 그래프
 *
 *   { lat:[...], lng:[...], name:[...],
 *     routes: [{ s:[정류장 인덱스...], t:[구간 초...], mode:'bus'|'subway' }] }
 */

import { TransitSource } from './TransitSource.js';

export class GraphJsonSource extends TransitSource {
  async load(network) {
    const g = await this.fetchJson();
    if (!g.routes || !g.lat) {
      throw new Error(`${this.label}: 그래프 형식이 아닙니다. npm run build:transit 으로 다시 빌드하세요.`);
    }

    // 정류장 인덱스를 네트워크 기준으로 옮겨 담기
    const offset = network.stopCount;
    for (let i = 0; i < g.lat.length; i++) network.addStop(g.lat[i], g.lng[i], g.name?.[i] ?? '');

    for (const r of g.routes) {
      network.addRoute({
        stops:  r.s.map(i => i + offset),
        times:  r.t,
        mode:   r.mode ?? this.defaultMode,
        name:   r.name ?? '',
        source: this.id,
      });
    }
  }
}
