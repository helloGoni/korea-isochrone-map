/**
 * 지리 계산 공통 유틸 + 이동 속도 상수
 */

export const WALK_SPEED_MPM = 80; // 도보 속도 (m/분)

/** 수단별 평균 속도 (m/분). 구간 시간이 없는 데이터는 이 값으로 추정합니다. */
export const MODE_SPEED_MPM = {
  subway:     583, // 35km/h
  light_rail: 583,
  tram:       583,
  train:      750, // 45km/h
  bus:        333, // 20km/h
  trolleybus: 333,
};
export const DEFAULT_MODE = 'bus';

/** 수단 → 표시용 한글 이름 */
export const MODE_LABEL = {
  subway: '지하철', light_rail: '경전철', tram: '트램', train: '철도',
  bus: '버스', trolleybus: '버스',
};

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const d1 = (lat2 - lat1) * Math.PI / 180;
  const d2 = (lng2 - lng1) * Math.PI / 180;
  const a  =
    Math.sin(d1 / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(d2 / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/** 거리(m) → 도보 시간(초) */
export const walkSeconds = meters => (meters / WALK_SPEED_MPM) * 60;
