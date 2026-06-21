/**
 * 주소 검색 — 카카오 지도 JS SDK의 services.Places 사용
 *
 * 외부 REST API 호출이 아니라 지도 SDK 내장 기능이라 별도 키·프록시·호출 제한이 없습니다.
 * (이동 시간 계산은 전부 로컬 그래프 + 다익스트라로 처리하므로 외부 API 호출이 없음)
 */

/**
 * 키워드로 장소 검색
 * @param {string} query
 * @returns {Promise<Array>}  [{ place_name, address_name, road_address_name, x, y }]
 */
export function searchPlaces(query) {
  return new Promise((resolve, reject) => {
    if (!window.kakao?.maps?.services) {
      reject(new Error('카카오 지도 SDK가 아직 로드되지 않았습니다.'));
      return;
    }
    const ps = new kakao.maps.services.Places();
    ps.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK) resolve(data);
      else if (status === kakao.maps.services.Status.ZERO_RESULT) resolve([]);
      else reject(new Error(`장소 검색 실패 (${status})`));
    });
  });
}
