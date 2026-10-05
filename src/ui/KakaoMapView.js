/**
 * 카카오 지도 래퍼 — 드래그 가능한 출발지 마커 · 등시간선 폴리곤 · 장소 검색
 */

const SDK_SELECTOR = 'script[src*="dapi.kakao.com/v2/maps"]';

export class KakaoMapView {
  /** 카카오 지도 SDK 동적 로드 (이미 로드됐으면 즉시 완료) */
  static loadSdk(jsKey) {
    return new Promise((resolve, reject) => {
      if (window.kakao?.maps?.services) { resolve(); return; }
      document.querySelector(SDK_SELECTOR)?.remove();

      const s = document.createElement('script');
      s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(jsKey)}&libraries=services&autoload=false`;
      s.onload  = () => kakao.maps.load(resolve);
      s.onerror = () => reject(new Error(
        '카카오 지도 SDK 로드 실패.\n' +
        '① JS 키가 맞는지 확인하세요.\n' +
        '② 카카오 개발자 콘솔 → 플랫폼 → Web에 현재 주소(포트 포함)가 등록됐는지 확인하세요.'
      ));
      document.head.appendChild(s);
    });
  }

  static get isSdkLoaded() { return !!window.kakao?.maps; }

  /**
   * @param {HTMLElement} container
   * @param {{ center: { lat, lng }, level?: number }} opts
   */
  constructor(container, { center, level = 8 }) {
    this.map = new kakao.maps.Map(container, { center: toLatLng(center), level });
    this.marker   = null;
    this.label    = null;
    this.polygon  = null;
    this.places   = new kakao.maps.services.Places();
    this.geocoder = new kakao.maps.services.Geocoder();
    this.dragEndHandlers = [];

    // 창 크기가 바뀌면 지도 타일 영역도 다시 맞춤 (안 하면 회색 빈 영역이 생김)
    window.addEventListener('resize', () => this.map.relayout());
  }

  /** 마커 드래그가 끝나면 cb({ lat, lng }) */
  onOriginDragEnd(cb) { this.dragEndHandlers.push(cb); }

  /** 출발지 마커(드래그 가능) + 이름 라벨 배치. 마커는 하나만 만들어 위치만 옮긴다. */
  setOrigin(coord, labelText, { recenter = true } = {}) {
    const pos = toLatLng(coord);

    if (!this.marker) {
      this.marker = new kakao.maps.Marker({
        position: pos, map: this.map, draggable: true, title: '드래그해서 출발지 이동',
      });
      this.label = new kakao.maps.CustomOverlay({ position: pos, yAnchor: 2.4, map: this.map });

      // 드래그 중에는 라벨이 따라오고, 끝나면 콜백
      kakao.maps.event.addListener(this.marker, 'drag', () => {
        this.label.setPosition(this.marker.getPosition());
      });
      kakao.maps.event.addListener(this.marker, 'dragend', () => {
        const p = this.marker.getPosition();
        this.dragEndHandlers.forEach(cb => cb({ lat: p.getLat(), lng: p.getLng() }));
      });
    }

    this.marker.setPosition(pos);
    this.label.setPosition(pos);
    this.setOriginLabel(labelText);
    if (recenter) this.map.setCenter(pos);
  }

  setOriginLabel(text) {
    if (!this.label) return;
    const el = document.createElement('div');
    el.className   = 'origin-label';
    el.textContent = text ?? '';
    this.label.setContent(el);
  }

  /**
   * 등시간선 폴리곤 — 여러 링을 한 폴리곤의 경로 배열로 전달.
   * 카카오 폴리곤은 even-odd 규칙이라 안쪽 링은 자동으로 '구멍(홀)'이 된다.
   * @param {Array<Array<{lat,lng}>>} rings
   */
  drawIsochrone(rings, fillColor, strokeColor) {
    this.clearIsochrone();
    const path = rings.filter(r => r && r.length >= 3).map(r => r.map(toLatLng));
    if (!path.length) return;

    this.polygon = new kakao.maps.Polygon({
      map: this.map,
      path,
      strokeWeight:  2,
      strokeColor,
      strokeOpacity: 0.9,
      fillColor,
      fillOpacity:   0.28,
    });
  }

  clearIsochrone() {
    this.polygon?.setMap(null);
    this.polygon = null;
  }

  /** 점들이 모두 보이도록 지도 범위 맞추기 */
  fitToPoints(points) {
    if (!points?.length) return;
    const bounds = new kakao.maps.LatLngBounds();
    points.forEach(p => bounds.extend(toLatLng(p)));
    this.map.setBounds(bounds);
  }

  /** 키워드 장소 검색 → [{ name, address, lat, lng }] (지도 SDK 내장 기능, 별도 API 호출 제한 없음) */
  searchPlaces(query) {
    return new Promise((resolve, reject) => {
      this.places.keywordSearch(query, (data, status) => {
        const S = kakao.maps.services.Status;
        if (status === S.OK) {
          resolve(data.map(p => ({
            name:    p.place_name,
            address: p.road_address_name || p.address_name,
            lat:     parseFloat(p.y),
            lng:     parseFloat(p.x),
          })));
        } else if (status === S.ZERO_RESULT) resolve([]);
        else reject(new Error(`장소 검색 실패 (${status})`));
      });
    });
  }

  /** 좌표 → 주소 문자열 (실패하면 null) */
  reverseGeocode({ lat, lng }) {
    return new Promise(resolve => {
      this.geocoder.coord2Address(lng, lat, (result, status) => {
        if (status !== kakao.maps.services.Status.OK || !result.length) { resolve(null); return; }
        const r = result[0];
        resolve(r.road_address?.address_name || r.address?.address_name || null);
      });
    });
  }
}

const toLatLng = p => new kakao.maps.LatLng(p.lat, p.lng);
