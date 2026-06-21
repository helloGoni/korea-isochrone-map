/**
 * 카카오 지도 초기화 · 마커 · 등시간선 폴리곤(단일, 실시간 갱신)
 */

let map          = null;
let centerMarker = null;
let labelOverlay = null;
let polygon      = null;   // 등시간선(단일 폴리곤, 여러 링=홀 처리)
let onDragEndCb  = null;

/** SDK 동적 로드 → 지도 초기화 */
export function initMap(jsKey) {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps) { renderMap(); resolve(); return; }

    const old = document.querySelector('script[src*="dapi.kakao.com/v2/maps"]');
    if (old) old.remove();

    const s = document.createElement('script');
    s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&libraries=services&autoload=false`;
    s.onload  = () => kakao.maps.load(() => { renderMap(); resolve(); });
    s.onerror = () => reject(new Error(
      '카카오 지도 SDK 로드 실패.\n' +
      '① JS 키가 맞는지 확인하세요.\n' +
      '② 카카오 개발자 콘솔 → 플랫폼 → Web에 현재 주소(포트 포함)가 등록됐는지 확인하세요.'
    ));
    document.head.appendChild(s);
  });
}

function renderMap() {
  map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level:  8,
  });
}

/** 지도 클릭 이벤트 등록 — cb({ lat, lng }) */
export function onMapClick(cb) {
  if (!map) return;
  kakao.maps.event.addListener(map, 'click', e => {
    const ll = e.latLng;
    cb({ lat: ll.getLat(), lng: ll.getLng() });
  });
}

/** 마커 드래그 종료 콜백 등록 — cb({ lat, lng }) */
export function setOnMarkerDragEnd(cb) { onDragEndCb = cb; }

/** 중심 마커(드래그 가능) + 이름 라벨 */
export function setCenterMarker(coord, label, { recenter = true } = {}) {
  if (!map) return;
  if (centerMarker) centerMarker.setMap(null);
  if (labelOverlay) labelOverlay.setMap(null);

  const pos = new kakao.maps.LatLng(coord.lat, coord.lng);
  centerMarker = new kakao.maps.Marker({ position: pos, map, draggable: true });

  // 드래그 중에는 라벨이 따라오도록, 종료 시 콜백
  kakao.maps.event.addListener(centerMarker, 'drag', () => {
    if (labelOverlay) labelOverlay.setPosition(centerMarker.getPosition());
  });
  kakao.maps.event.addListener(centerMarker, 'dragend', () => {
    const p = centerMarker.getPosition();
    onDragEndCb?.({ lat: p.getLat(), lng: p.getLng() });
  });

  if (label) {
    labelOverlay = new kakao.maps.CustomOverlay({
      content: `<div style="
        background:#0f172a;color:#fff;padding:5px 12px;
        border-radius:20px;font-size:12px;font-weight:700;
        white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3);
        margin-bottom:6px;
      ">${label}</div>`,
      position: pos,
      yAnchor:  2.4,
    });
    labelOverlay.setMap(map);
  }

  if (recenter) map.setCenter(pos);
}

/**
 * 등시간선 폴리곤 그리기 — 여러 링을 한 폴리곤의 경로 배열로 전달.
 * 카카오 폴리곤은 even-odd 규칙으로 채우므로, 안쪽에 들어간 링은
 * 자동으로 '구멍(홀)'이 되어 초록 안에 초록이 겹치지 않습니다.
 *
 * @param {Array<Array<{lat,lng}>>} rings
 * @param {string} fillColor   16진수 색
 * @param {string} strokeColor 16진수 색
 */
export function drawIsochrone(rings, fillColor, strokeColor) {
  if (!map) return;
  clearIsochrone();

  const paths = rings
    .filter(r => r && r.length >= 3)
    .map(r => r.map(p => new kakao.maps.LatLng(p.lat, p.lng)));
  if (!paths.length) return;

  polygon = new kakao.maps.Polygon({
    map,
    path: paths,            // 경로 배열 → 홀 처리
    strokeWeight:  2,
    strokeColor,
    strokeOpacity: 0.9,
    fillColor,
    fillOpacity:   0.28,
  });
}

/** 폴리곤 제거 */
export function clearIsochrone() {
  if (polygon) { polygon.setMap(null); polygon = null; }
}

/** 점들이 모두 보이도록 지도 범위 맞추기 */
export function fitToPoints(points) {
  if (!map || !points || points.length === 0) return;
  const bounds = new kakao.maps.LatLngBounds();
  points.forEach(p => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
  map.setBounds(bounds);
}
