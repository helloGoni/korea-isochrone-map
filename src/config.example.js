// src/config.js 를 이 파일을 복사해서 만드세요. (git에 커밋되지 않음)
//
// 이동 시간 계산은 전부 기기 안(브라우저)에서 처리합니다.
// 카카오 JavaScript 키는 지도 표시와 주소 검색에만 쓰입니다.

export const KAKAO_JS_KEY = '';   // 카카오 JavaScript 앱 키 — developers.kakao.com

// ── 동작 설정 (숫자만 바꾸면 됩니다) ──────────────────────────
// 표시 시간 슬라이더의 최댓값(분). 슬라이더는 0 ~ 이 값.
export const MAX_MINUTES = 120;

// 정밀도 = 격자 한 칸 크기(m). 작을수록 경계가 정밀하지만 계산이 느려집니다.
// 권장 80~250. (예: 60=매우 정밀/무거움, 100=정밀, 200=가벼움)
export const GRID_CELL_M = 100;
