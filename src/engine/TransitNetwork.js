/**
 * 대중교통 네트워크 — 정류장 + 노선(정류장 순서·구간 시간) + 라우팅 인덱스
 *
 * 여러 데이터 소스(OSM 그래프, 버스 CSV 등)가 각자 addStop / addRoute 로
 * 같은 네트워크에 노선을 쌓고, 마지막에 finalize() 로 인덱스를 만듭니다.
 * 소스가 달라도 350m 이내 정류장끼리는 도보 환승으로 자동 연결됩니다.
 */

import {
  haversineMeters, walkSeconds, MODE_SPEED_MPM, DEFAULT_MODE,
} from './geo.js';

const MIN_SEGMENT_SEC = 10;
const MAX_SEGMENT_SEC = 3600;

export class TransitNetwork {
  /**
   * @param {{ transferRadiusM?: number }} opts  도보 환승 허용 거리(m)
   */
  constructor({ transferRadiusM = 350 } = {}) {
    this.transferRadiusM = transferRadiusM;

    this.lat  = [];
    this.lng  = [];
    this.name = [];
    /** @type {{ s:number[], t:number[], mode:string, name:string, source:string }[]} */
    this.routes = [];
    /** 소스별 통계 — 화면의 데이터 범위 안내에 사용 */
    this.sources = [];

    this.stopRoutes = null; // stopRoutes[stop] = [routeId...]
    this.footpaths  = null; // footpaths[stop]  = [[toStop, walkSec]...]
  }

  get stopCount()  { return this.lat.length; }
  get routeCount() { return this.routes.length; }
  get isReady()    { return this.stopRoutes !== null; }

  /** 정류장 추가 → 인덱스 반환 */
  addStop(lat, lng, name = '') {
    this.lat.push(lat);
    this.lng.push(lng);
    this.name.push(name);
    this.stopRoutes = null; // 인덱스 무효화
    return this.lat.length - 1;
  }

  /**
   * 노선 추가.
   * @param {object} r
   * @param {number[]} r.stops   정류장 인덱스 순서
   * @param {number[]} [r.times] 구간 시간(초), 길이 = stops.length - 1. 없으면 수단 속도로 추정
   * @param {string}   [r.mode]  'bus' | 'subway' | ...
   * @param {string}   [r.name]  노선 이름(번호)
   * @param {string}   [r.source] 데이터 소스 id
   * @returns {boolean} 추가되었는지 (정류장 2개 미만이면 무시)
   */
  addRoute({ stops, times, mode = DEFAULT_MODE, name = '', source = '' }) {
    const speed = MODE_SPEED_MPM[mode] ?? MODE_SPEED_MPM[DEFAULT_MODE];
    const s = [], t = [];

    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      if (st == null || st < 0) continue;
      if (s.length && s[s.length - 1] === st) continue; // 연속 중복 제거
      if (s.length) {
        let sec = times?.[i - 1];
        if (!(sec > 0)) {
          const a = s[s.length - 1];
          sec = (haversineMeters(this.lat[a], this.lng[a], this.lat[st], this.lng[st]) / speed) * 60;
        }
        t.push(Math.max(MIN_SEGMENT_SEC, Math.min(MAX_SEGMENT_SEC, Math.round(sec))));
      }
      s.push(st);
    }
    if (s.length < 2) return false;

    this.routes.push({ s, t, mode, name, source });
    this.stopRoutes = null;
    return true;
  }

  /** 소스 로드 결과 기록 (화면 안내용) */
  recordSource(info) { this.sources.push(info); }

  /** 수단별 노선 수 — { bus: 1598, subway: 185 } */
  modeCounts(sourceId) {
    const out = {};
    for (const r of this.routes) {
      if (sourceId && r.source !== sourceId) continue;
      out[r.mode] = (out[r.mode] || 0) + 1;
    }
    return out;
  }

  /** 라우팅 인덱스 구축 (모든 소스를 추가한 뒤 1회) */
  finalize() {
    this.stopRoutes = this.#buildStopRoutes();
    this.footpaths  = this.#buildFootpaths();
    return this;
  }

  /** (lat,lng)에서 radiusM 이내 정류장 → [[stopIdx, meters]...] */
  stopsWithin(lat, lng, radiusM) {
    const out = [];
    for (let i = 0; i < this.lat.length; i++) {
      const m = haversineMeters(lat, lng, this.lat[i], this.lng[i]);
      if (m <= radiusM) out.push([i, m]);
    }
    return out;
  }

  #buildStopRoutes() {
    const idx = Array.from({ length: this.stopCount }, () => null);
    this.routes.forEach((route, rid) => {
      for (const st of route.s) (idx[st] || (idx[st] = [])).push(rid);
    });
    return idx;
  }

  /** 반경 이내 정류장끼리 도보 환승 인접 리스트 (그리드 가속) */
  #buildFootpaths() {
    const n       = this.stopCount;
    const radius  = this.transferRadiusM;
    const foot    = Array.from({ length: n }, () => null);
    const cellDeg = (radius / 111000) * 1.5;
    const grid    = new Map();
    const { lat, lng } = this;

    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(lng[i] / cellDeg)},${Math.floor(lat[i] / cellDeg)}`;
      (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(lng[i] / cellDeg);
      const cy = Math.floor(lat[i] / cellDeg);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(`${cx + dx},${cy + dy}`);
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const m = haversineMeters(lat[i], lng[i], lat[j], lng[j]);
            if (m <= radius) {
              const sec = Math.round(walkSeconds(m));
              (foot[i] || (foot[i] = [])).push([j, sec]);
              (foot[j] || (foot[j] = [])).push([i, sec]);
            }
          }
        }
      }
    }
    return foot;
  }
}
