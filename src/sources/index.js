/**
 * 데이터 소스 레지스트리 + 매니페스트(data/sources.json) 로더
 *
 * sources.json 에 항목을 추가하기만 하면 그 데이터가 네트워크에 합쳐지고
 * 경로 탐색·등시간선에 바로 반영됩니다.
 */

import { TransitNetwork } from '../engine/TransitNetwork.js';
import { GraphJsonSource } from './GraphJsonSource.js';
import { RouteJsonSource } from './RouteJsonSource.js';
import { RouteCsvSource } from './RouteCsvSource.js';

/** type 이름 → 소스 클래스 */
export const SOURCE_TYPES = {
  'graph-json':  GraphJsonSource,
  'routes-json': RouteJsonSource,
  'routes-csv':  RouteCsvSource,
};

export function createSource(spec, baseUrl) {
  const Cls = SOURCE_TYPES[spec.type];
  if (!Cls) {
    throw new Error(`알 수 없는 데이터 형식 "${spec.type}" — 지원: ${Object.keys(SOURCE_TYPES).join(', ')}`);
  }
  return new Cls(spec, baseUrl);
}

/**
 * 매니페스트의 모든 소스(enabled !== false)를 읽어 하나의 네트워크로 구성.
 * 일부 소스가 실패해도 나머지로 동작하며, 실패 내용은 network.sources 에 남깁니다.
 */
export async function loadNetwork(manifestUrl) {
  const base = new URL(manifestUrl, globalThis.location?.href);
  const res  = await fetch(base);
  if (!res.ok) throw new Error(`데이터 목록(${manifestUrl})을 불러올 수 없습니다 (${res.status}).`);
  const manifest = await res.json();

  const specs   = (manifest.sources ?? []).filter(s => s.enabled !== false);
  const network = new TransitNetwork(manifest.options ?? {});

  for (const spec of specs) {
    try {
      await createSource(spec, base).loadInto(network);
    } catch (e) {
      console.error(e);
      network.recordSource({ id: spec.id, label: spec.label ?? spec.id, error: e.message, routes: 0, modes: {} });
    }
  }

  if (network.routeCount === 0) {
    const errors = network.sources.filter(s => s.error).map(s => s.error);
    throw new Error(`불러온 노선이 없습니다.${errors.length ? '\n' + errors.join('\n') : ''}`);
  }
  return network.finalize();
}
