/**
 * 앱 진입점 — 설정을 읽어 IsochroneApp 시작
 *
 * src/config.js 가 없으면 config.example.js 의 기본값으로 동작합니다(키는 입력 화면에서).
 * 이전 버전의 config.js 에 새 항목이 없어도 아래 기본값이 쓰입니다.
 */

import { IsochroneApp } from './app/IsochroneApp.js';

const config = await import('./config.js').catch(() => import('./config.example.js'));

new IsochroneApp({
  kakaoKey:      config.KAKAO_JS_KEY || '',
  maxMinutes:    Number(config.MAX_MINUTES) || 120,
  cellM:         Number(config.GRID_CELL_M) || 100,
  defaultOrigin: config.DEFAULT_ORIGIN ?? { lat: 37.5559, lng: 126.9723, name: '서울역' },
  manifestUrl:   'data/sources.json',
}).start();
