/**
 * type: "routes-json" — 사람이 쓰기 쉬운 노선 목록 JSON
 *
 *   { "routes": [
 *       { "name": "472", "mode": "bus",
 *         "stops": [ { "id": "02123", "name": "서울역", "lat": 37.5559, "lng": 126.9723 }, ... ] }
 *   ] }
 *
 * - stops 는 운행 순서대로. id 가 같으면 같은 정류장으로 합칩니다.
 * - 구간 시간(times, 초)은 선택. 없으면 수단 평균 속도로 추정합니다.
 */

import { TransitSource, StopRegistry } from './TransitSource.js';

export class RouteJsonSource extends TransitSource {
  async load(network) {
    const data   = await this.fetchJson();
    const routes = Array.isArray(data) ? data : data.routes;
    if (!Array.isArray(routes)) throw new Error(`${this.label}: "routes" 배열이 없습니다.`);

    const stops = new StopRegistry(network);
    for (const r of routes) {
      network.addRoute({
        stops:  (r.stops ?? []).map(st => stops.resolve({
          id: st.id, name: st.name, lat: Number(st.lat), lng: Number(st.lng ?? st.lon),
        })),
        times:  r.times,
        mode:   r.mode ?? this.defaultMode,
        name:   r.name ?? '',
        source: this.id,
      });
    }
  }
}
