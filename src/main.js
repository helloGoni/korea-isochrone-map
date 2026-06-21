/**
 * 앱 진입점 — 로컬 대중교통 등시간선 (기기 안에서 전부 계산)
 *
 * 흐름:
 *   1. 카카오 지도 로드(JS 키) → 출발지 설정(검색 / 지도 클릭 / 마커 드래그)
 *   2. "계산" 시 그래프 로드 + 다익스트라 1회 → 시간장(time field) 1회 구축
 *   3. 슬라이더(0~MAX_MINUTES)를 움직이면 시간장에서 등고선만 즉시 다시 뽑음
 *
 * 표시 시간(MAX_MINUTES)·정밀도(GRID_CELL_M)는 src/config.js 에서 숫자로 조절.
 */

import { KAKAO_JS_KEY, MAX_MINUTES, GRID_CELL_M } from './config.js';
import { searchPlaces } from './api.js';
import {
  initMap, onMapClick, setOnMarkerDragEnd, setCenterMarker,
  drawIsochrone, clearIsochrone, fitToPoints,
} from './map.js';
import { loadGraph, findReachable, computeTimeField, extractContour } from './transit-router.js';

// config 값 (없으면 기본값)
const MAX_MIN = Number(MAX_MINUTES) || 120;
const CELL_M  = Number(GRID_CELL_M) || 120;

// ── 상태 ──────────────────────────────────────────
let center      = null;   // { lat, lng, name }
let field       = null;   // computeTimeField 결과 (현재 center 기준)
let maxTransfer = 2;      // 최대 환승 횟수
let hasComputed = false;  // 한 번이라도 계산했는지 (드래그 자동 재계산용)

// ── DOM ───────────────────────────────────────────
const $ = id => document.getElementById(id);

const apiKeyPanel   = $('api-key-panel');
const sidePanel     = $('side-panel');
const inputJsKey    = $('input-js-key');
const btnApplyKeys  = $('btn-apply-keys');
const keyError      = $('key-error');
const inputAddress  = $('input-address');
const btnSearch     = $('btn-search');
const searchResults = $('search-results');
const btnRun        = $('btn-run');
const progressArea  = $('progress-area');
const progressBar   = $('progress-bar');
const progressText  = $('progress-text');
const timeSlider     = $('time-slider');
const timeValue      = $('time-value');
const sliderScale    = $('slider-scale');
const transferSlider = $('transfer-slider');
const transferValue  = $('transfer-value');
const statusEl      = $('status');
const legend        = $('legend');
const btnResetKeys  = $('btn-reset-keys');

// ── 초기화 ────────────────────────────────────────
(function init() {
  // 슬라이더 범위/눈금을 config(MAX_MIN)에 맞춤
  const defaultVal = Math.round(MAX_MIN / 2 / 5) * 5;
  timeSlider.max   = MAX_MIN;
  timeSlider.value = defaultVal;
  timeValue.textContent = `${defaultVal}분`;
  sliderScale.innerHTML = [0, 0.25, 0.5, 0.75, 1]
    .map((f, i) => `<span>${Math.round(MAX_MIN * f)}${i === 4 ? '분' : ''}</span>`)
    .join('');

  const js = KAKAO_JS_KEY || localStorage.getItem('kakao_js_key') || '';
  inputJsKey.value = js;
  if (js) applyKey(js);
})();

// ── 이벤트 ────────────────────────────────────────
btnApplyKeys.addEventListener('click', () => {
  const js = inputJsKey.value.trim();
  if (!js) { alert('카카오 JavaScript 키를 입력해주세요.'); return; }
  localStorage.setItem('kakao_js_key', js);
  applyKey(js);
});

btnResetKeys.addEventListener('click', () => {
  sidePanel.classList.add('hidden');
  apiKeyPanel.classList.remove('hidden');
});

btnSearch.addEventListener('click', handleSearch);
inputAddress.addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });

btnRun.addEventListener('click', () => handleCompute({ fit: true }));

// 표시 시간 슬라이더: 움직이는 즉시 등고선 재추출 (재계산 없음)
timeSlider.addEventListener('input', () => {
  timeValue.textContent = `${timeSlider.value}분`;
  if (field) updateIsochrone();
});

// 최대 환승 슬라이더: 값이 바뀌면 경로를 다시 계산해야 함
transferSlider.addEventListener('input', () => {
  maxTransfer = parseInt(transferSlider.value, 10);
  transferValue.textContent = `${maxTransfer}회`;
});
transferSlider.addEventListener('change', () => {
  if (hasComputed) handleCompute({ fit: false }); // 드래그 끝나면 재계산
});

// ── 함수 ──────────────────────────────────────────

async function applyKey(jsKey) {
  keyError.classList.add('hidden');
  btnApplyKeys.disabled = true;
  btnApplyKeys.textContent = '로딩 중...';
  try {
    await initMap(jsKey);
    apiKeyPanel.classList.add('hidden');
    sidePanel.classList.remove('hidden');
    // 지도 클릭으로 출발지 지정
    onMapClick(c => setCenter({ lat: c.lat, lng: c.lng, name: coordName(c) }));
    // 마커를 드래그해 위치 미세 조정 → 이미 계산했다면 자동 재계산
    setOnMarkerDragEnd(c => setCenter(
      { lat: c.lat, lng: c.lng, name: coordName(c) },
      { recenter: false, autoCompute: true },
    ));
  } catch (e) {
    keyError.textContent = e.message;
    keyError.classList.remove('hidden');
  } finally {
    btnApplyKeys.disabled = false;
    btnApplyKeys.textContent = '지도 열기';
  }
}

async function handleSearch() {
  const query = inputAddress.value.trim();
  if (!query) return;
  btnSearch.disabled = true;
  searchResults.innerHTML = '';
  searchResults.classList.add('hidden');
  try {
    const places = await searchPlaces(query);
    if (!places.length) {
      searchResults.innerHTML = '<div class="result-item"><div class="name">검색 결과 없음</div></div>';
      searchResults.classList.remove('hidden');
      return;
    }
    places.forEach(p => {
      const el = document.createElement('div');
      el.className = 'result-item';
      el.innerHTML = `<div class="name">${p.place_name}</div>
                      <div class="addr">${p.road_address_name || p.address_name}</div>`;
      el.addEventListener('click', () => {
        setCenter({ lat: parseFloat(p.y), lng: parseFloat(p.x), name: p.place_name });
        searchResults.classList.add('hidden');
      });
      searchResults.appendChild(el);
    });
    searchResults.classList.remove('hidden');
  } catch (e) {
    showStatus(e.message, 'error');
  } finally {
    btnSearch.disabled = false;
  }
}

const coordName = c => `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;

/**
 * 출발지 설정
 * @param {object} coord
 * @param {{ recenter?, autoCompute? }} opts
 */
function setCenter(coord, opts = {}) {
  const { recenter = true, autoCompute = false } = opts;
  center = coord;
  inputAddress.value = coord.name;
  searchResults.classList.add('hidden');
  setCenterMarker(center, center.name, { recenter });
  btnRun.disabled = false;
  hideStatus();

  if (autoCompute && hasComputed) {
    handleCompute({ fit: false }); // 마커 드래그 → 같은 시점 유지하며 다시 그림
  } else {
    field = null;
    clearIsochrone();
    legend.classList.add('hidden');
    timeSlider.disabled = true;
  }
}

async function handleCompute({ fit = true } = {}) {
  if (!center) return;

  btnRun.disabled = true;
  hideStatus();
  setProgress(20, '그래프 로딩 중...');

  try {
    await loadGraph('data/transit-graph.json');

    setProgress(55, '경로 탐색 중...');
    const reachable = findReachable(center, MAX_MIN, maxTransfer);

    setProgress(80, '도달 영역 계산 중...');
    field = computeTimeField(center, reachable, { cellM: CELL_M });

    setProgress(100, '완료');

    timeSlider.disabled = false;
    hasComputed = true;
    updateIsochrone();

    if (fit) {
      // 현재 슬라이더 값의 영역에 맞춰 적당히 확대 (전체 최대 범위로 멀리 빠지지 않음)
      const minutes = parseInt(timeSlider.value, 10);
      const rings = extractContour(field, minutes);
      fitToPoints(rings.flat());
    }

    showStatus(`완료 · 도달 정류장 ${reachable.length.toLocaleString()}개`, 'success');
  } catch (e) {
    showStatus(e.message, 'error');
  } finally {
    btnRun.disabled = false;
    clearProgress();
  }
}

/** 현재 슬라이더 값으로 등고선 갱신 (시간장에서 추출만) */
function updateIsochrone() {
  const minutes = parseInt(timeSlider.value, 10);
  const rings = extractContour(field, minutes);
  const { fill, stroke } = colorFor(minutes);

  if (rings.length) drawIsochrone(rings, fill, stroke);
  else              clearIsochrone();

  renderLegend(minutes, fill);
}

function renderLegend(minutes, fill) {
  legend.innerHTML = `
    <div class="legend-title">📡 로컬 대중교통 (버스+지하철)</div>
    <div class="legend-row">
      <div class="legend-swatch" style="background:${fill}"></div>
      <span><b>${minutes}분 이내</b> 도달 영역 · 환승 최대 ${maxTransfer}회</span>
    </div>`;
  legend.classList.remove('hidden');
}

// 시간(0~MAX) → 색 (가까움=초록 → 멈=빨강)
function colorFor(minutes) {
  const t   = Math.max(0, Math.min(1, minutes / MAX_MIN));
  const hue = 140 - 140 * t; // 140(초록) → 0(빨강)
  return { fill: hslToHex(hue, 70, 50), stroke: hslToHex(hue, 75, 40) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ── 진행 바 ───────────────────────────────────────
function setProgress(pct, label) {
  progressArea.classList.remove('hidden');
  progressBar.style.width = `${pct}%`;
  progressText.textContent = label;
}
function clearProgress() {
  progressArea.classList.add('hidden');
  progressBar.style.width = '0%';
}

// ── 상태 메시지 ───────────────────────────────────
function showStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className   = `status ${type}`;
  statusEl.classList.remove('hidden');
}
function hideStatus() { statusEl.classList.add('hidden'); }
