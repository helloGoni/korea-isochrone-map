/**
 * 데이터 소스 기본 클래스
 *
 * data/sources.json 의 항목 하나 = 소스 하나.
 * 하위 클래스는 load(network) 에서 network.addStop / addRoute 로
 * 정류장과 노선을 추가하기만 하면 됩니다. 라우팅·시간장은 자동으로 따라옵니다.
 *
 * 새 형식을 지원하려면:
 *   1. TransitSource 를 상속해 load() 구현
 *   2. src/sources/index.js 의 SOURCE_TYPES 에 등록
 */

export class TransitSource {
  /**
   * @param {object} spec    sources.json 의 항목 ({ id, type, url, label, mode, note, ... })
   * @param {string} baseUrl url 해석 기준 (sources.json 위치)
   */
  constructor(spec, baseUrl) {
    if (!spec.url) throw new Error(`데이터 소스에 url 이 없습니다: ${JSON.stringify(spec)}`);
    this.spec  = spec;
    this.id    = spec.id ?? spec.url;
    this.label = spec.label ?? this.id;
    this.url   = new URL(spec.url, baseUrl).href;
  }

  /** 하위 클래스에서 구현 — network 에 정류장/노선 추가 */
  async load(network) { // eslint-disable-line no-unused-vars
    throw new Error(`${this.constructor.name}.load() 가 구현되지 않았습니다.`);
  }

  /** load() 를 실행하고 결과(노선 수·수단별 통계)를 네트워크에 기록 */
  async loadInto(network) {
    const before = { stops: network.stopCount, routes: network.routeCount };
    await this.load(network);
    const info = {
      id:     this.id,
      label:  this.label,
      note:   this.spec.note ?? '',
      stops:  network.stopCount - before.stops,
      routes: network.routeCount - before.routes,
      modes:  network.modeCounts(this.id),
    };
    network.recordSource(info);
    return info;
  }

  async fetchResponse() {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`${this.label}: 파일을 불러올 수 없습니다 (${res.status} ${this.spec.url})`);
    return res;
  }

  async fetchJson() {
    return (await this.fetchResponse()).json();
  }

  /** 텍스트 읽기 — spec.encoding 으로 EUC-KR(CP949) 같은 공공데이터 인코딩 지원 */
  async fetchText() {
    const buf = await (await this.fetchResponse()).arrayBuffer();
    return new TextDecoder(this.spec.encoding ?? 'utf-8').decode(buf).replace(/^﻿/, '');
  }

  /** 소스가 지정한 기본 수단 (항목별 mode 가 없을 때) */
  get defaultMode() { return this.spec.mode ?? 'bus'; }
}

/**
 * 같은 정류장을 한 번만 추가하기 위한 도우미 (id 또는 좌표+이름으로 식별)
 */
export class StopRegistry {
  constructor(network) {
    this.network = network;
    this.byKey   = new Map();
  }

  /** @returns {number} 정류장 인덱스 (좌표가 잘못되면 -1) */
  resolve({ id, name = '', lat, lng }) {
    if (!isValidCoord(lat, lng)) return -1;
    const key = id != null && id !== '' ? `id:${id}` : `${lat.toFixed(6)},${lng.toFixed(6)},${name}`;
    let idx = this.byKey.get(key);
    if (idx === undefined) {
      idx = this.network.addStop(lat, lng, name);
      this.byKey.set(key, idx);
    }
    return idx;
  }
}

/** 한국 일대 WGS84 좌표인지 (TM 좌표 등 잘못된 값 거르기) */
export function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
         lat > 32 && lat < 39.5 && lng > 124 && lng < 132;
}
