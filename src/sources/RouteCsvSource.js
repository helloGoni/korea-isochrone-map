/**
 * type: "routes-csv" — "노선별 정류장 순서" CSV (공공데이터포털·지자체 버스 데이터 형식)
 *
 * 한 행 = (노선, 순번, 정류장). 같은 노선의 행을 순번대로 이어 노선을 만듭니다.
 *
 *   노선명,순번,정류소ID,정류소명,X좌표,Y좌표
 *   472,1,101000001,서울역,126.9723,37.5559
 *   472,2,101000002,숭례문,126.9752,37.5610
 *
 * 열 이름은 흔히 쓰는 이름(아래 COLUMN_CANDIDATES)을 자동 인식합니다.
 * 다르면 sources.json 항목에 "columns": { "route": "ROUTE_NM", ... } 로 지정하세요.
 * 좌표는 WGS84 위경도(도 단위)여야 합니다. EUC-KR 파일은 "encoding": "euc-kr".
 */

import { TransitSource, StopRegistry } from './TransitSource.js';

const COLUMN_CANDIDATES = {
  route:    ['route_id', 'ROUTE_ID', '노선ID', '노선아이디', 'route', 'route_name', 'ROUTE_NM', '노선명', '노선번호'],
  routeName:['route_name', 'ROUTE_NM', '노선명', '노선번호', 'route'],
  seq:      ['seq', 'SEQ', '순번', '순서', '정류소순번', '정류장순서', 'STATION_ORDER', 'STA_ORDER', 'stop_sequence'],
  stopId:   ['stop_id', 'STOP_ID', '정류소ID', '정류장ID', 'NODE_ID', 'STATION_ID', 'ARS_ID', '정류소번호'],
  stopName: ['stop_name', 'STOP_NM', '정류소명', '정류장명', 'STATION_NM', 'NODE_NM', 'name'],
  lat:      ['lat', 'LAT', 'latitude', '위도', 'Y좌표', 'GPS_Y', 'GPSY', 'Y', 'stop_lat'],
  lng:      ['lng', 'lon', 'LNG', 'LON', 'longitude', '경도', 'X좌표', 'GPS_X', 'GPSX', 'X', 'stop_lon'],
  mode:     ['mode', '수단'],
};

export class RouteCsvSource extends TransitSource {
  async load(network) {
    const rows = parseCsv(await this.fetchText());
    if (rows.length < 2) throw new Error(`${this.label}: CSV 에 데이터가 없습니다.`);

    const col = this.#resolveColumns(rows[0]);
    const groups = new Map(); // 노선 키 → { name, mode, items: [{ seq, stop }] }
    let skipped = 0;
    const stops = new StopRegistry(network);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 1 && row[0] === '') continue; // 빈 줄
      const key  = row[col.route];
      const stop = stops.resolve({
        id:   col.stopId >= 0 ? row[col.stopId] : undefined,
        name: col.stopName >= 0 ? row[col.stopName] : '',
        lat:  parseFloat(row[col.lat]),
        lng:  parseFloat(row[col.lng]),
      });
      if (!key || stop < 0) { skipped++; continue; }

      let g = groups.get(key);
      if (!g) {
        g = {
          name:  col.routeName >= 0 ? row[col.routeName] : key,
          mode:  (col.mode >= 0 && row[col.mode]) || this.defaultMode,
          items: [],
        };
        groups.set(key, g);
      }
      g.items.push({ seq: col.seq >= 0 ? parseFloat(row[col.seq]) : g.items.length, stop });
    }

    for (const g of groups.values()) {
      g.items.sort((a, b) => a.seq - b.seq);
      network.addRoute({ stops: g.items.map(it => it.stop), mode: g.mode, name: g.name, source: this.id });
    }
    if (skipped) console.warn(`[transit] ${this.label}: 좌표/노선이 잘못된 ${skipped}행을 건너뛰었습니다.`);
  }

  /** 헤더에서 각 의미의 열 위치 찾기 (spec.columns 가 우선) */
  #resolveColumns(header) {
    const names = header.map(h => h.trim());
    const find  = (field) => {
      const wanted = this.spec.columns?.[field];
      if (wanted) return names.indexOf(wanted);
      for (const c of COLUMN_CANDIDATES[field]) {
        const i = names.indexOf(c);
        if (i >= 0) return i;
      }
      return -1;
    };
    const col = Object.fromEntries(Object.keys(COLUMN_CANDIDATES).map(f => [f, find(f)]));

    const missing = ['route', 'lat', 'lng'].filter(f => col[f] < 0);
    if (missing.length) {
      throw new Error(
        `${this.label}: CSV 에서 필수 열(${missing.join(', ')})을 찾지 못했습니다. ` +
        `sources.json 의 "columns" 로 열 이름을 지정하세요. (헤더: ${names.join(', ')})`
      );
    }
    return col;
  }
}

/** 따옴표("...")·CRLF 를 지원하는 최소 CSV 파서 → string[][] */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(f => f.trim()));
}
