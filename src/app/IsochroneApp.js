/**
 * 앱 컨트롤러 — 화면(KeyGate·ControlPanel·KakaoMapView)과 엔진(IsochroneEngine)을 잇는다
 *
 * 흐름:
 *   1. 카카오 지도 로드 → 출발지 마커를 기본 위치(서울역)에 놓음
 *   2. 마커 드래그 / 주소 검색으로 출발지 이동
 *   3. "계산" 시 RAPTOR 1회 + 시간장 1회 → 이후 마커를 옮기면 자동 재계산
 *   4. 표시 시간 슬라이더는 시간장에서 등고선만 즉시 다시 뽑음
 */

import { IsochroneEngine } from '../engine/IsochroneEngine.js';
import { KakaoMapView } from '../ui/KakaoMapView.js';
import { ControlPanel } from '../ui/ControlPanel.js';
import { KeyGate } from '../ui/KeyGate.js';
import { isochroneColor } from '../ui/colors.js';

const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const coordName = c => `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;

export class IsochroneApp {
  /**
   * @param {object} cfg
   * @param {string} cfg.kakaoKey     기본 카카오 JS 키 (없으면 입력 화면)
   * @param {number} cfg.maxMinutes   표시 시간 최댓값(분)
   * @param {number} cfg.cellM        격자 한 칸(m)
   * @param {{ lat, lng, name }} cfg.defaultOrigin  처음 마커 위치
   * @param {string} cfg.manifestUrl  데이터 소스 목록
   */
  constructor(cfg) {
    this.cfg    = cfg;
    this.engine = new IsochroneEngine({
      manifestUrl: cfg.manifestUrl, maxMinutes: cfg.maxMinutes, cellM: cfg.cellM,
    });

    this.map         = null;
    this.origin      = null;   // { lat, lng, name }
    this.field       = null;   // 현재 출발지 기준 시간장
    this.hasComputed = false;  // 한 번이라도 계산했는지 (드래그 자동 재계산용)
    this.originToken = 0;      // 주소 조회 응답 순서 보장용

    this.keyGate = new KeyGate({
      builtinKey: cfg.kakaoKey,
      onSubmit:   key => this.#openMap(key),
    });

    this.panel = new ControlPanel({
      maxMinutes: cfg.maxMinutes,
      on: {
        search:         q => this.#search(q),
        pickPlace:      p => this.setOrigin({ lat: p.lat, lng: p.lng, name: p.name }),
        compute:        () => this.compute({ fit: true }),
        timeChange:     () => this.#redraw(),
        transferChange: () => { if (this.hasComputed) this.compute({ fit: false }); },
        changeKey:      () => this.keyGate.show(undefined, { cancellable: true }),
      },
    });
  }

  start() {
    // 데이터는 지도와 별개로 미리 받아 두고, 범위 안내를 표시
    this.engine.load()
      .then(net => this.panel.showCoverage(net.sources))
      .catch(e => this.panel.showCoverageError(e.message));

    const key = this.keyGate.currentKey;
    if (key) this.#openMap(key);
    else     this.keyGate.show();
  }

  /**
   * 출발지 변경
   * @param {{ lat, lng, name }} origin
   * @param {{ recenter?: boolean }} opts
   */
  setOrigin(origin, { recenter = true } = {}) {
    this.origin = origin;
    this.originToken++;
    this.panel.setOriginName(origin.name);
    this.panel.hideSearchResults();
    this.panel.hideStatus();
    this.map.setOrigin(origin, origin.name, { recenter });

    if (this.hasComputed) {
      this.compute({ fit: false }); // 이미 계산했다면 같은 시점에서 다시 그림
    } else {
      this.field = null;
      this.map.clearIsochrone();
      this.panel.hideLegend();
      this.panel.setTimeEnabled(false);
    }
  }

  async compute({ fit = true } = {}) {
    if (!this.origin) return;
    const { panel } = this;
    panel.setRunEnabled(false);
    panel.hideStatus();

    try {
      panel.setProgress(20, '대중교통 데이터 불러오는 중...');
      await this.engine.load();

      panel.setProgress(55, '경로 탐색 중...');
      await nextFrame();
      const { field, reachableCount } = this.engine.compute(this.origin, { maxTransfers: panel.maxTransfers });

      panel.setProgress(100, '완료');
      this.field       = field;
      this.hasComputed = true;
      panel.setTimeEnabled(true);
      const rings = this.#redraw();

      // 현재 슬라이더 값의 영역에 맞춰 확대 (최대 범위로 멀리 빠지지 않음)
      if (fit) this.map.fitToPoints(rings.flat());

      panel.showStatus(`완료 · 도달 정류장 ${reachableCount.toLocaleString()}개`, 'success');
    } catch (e) {
      panel.showStatus(e.message, 'error');
    } finally {
      panel.setRunEnabled(true);
      panel.clearProgress();
    }
  }

  // ── 내부 ──────────────────────────────────────────

  async #openMap(key) {
    // SDK 는 한 페이지에 한 번만 로드됨 → 키를 바꾸면 새로고침해서 적용
    if (KakaoMapView.isSdkLoaded) { location.reload(); return; }

    this.keyGate.setLoading(true);
    try {
      await KakaoMapView.loadSdk(key);
      const origin = this.cfg.defaultOrigin;
      this.map = new KakaoMapView(document.getElementById('map'), { center: origin });
      this.map.onOriginDragEnd(c => this.#onMarkerDragged(c));

      this.keyGate.hide();
      this.panel.show();
      this.setOrigin(origin);
    } catch (e) {
      this.keyGate.show(e.message);
    } finally {
      this.keyGate.setLoading(false);
    }
  }

  /** 마커 드래그 → 출발지 이동, 주소는 뒤이어 조회해서 라벨 갱신 */
  async #onMarkerDragged(coord) {
    this.setOrigin({ ...coord, name: coordName(coord) }, { recenter: false });
    const token = this.originToken;
    const address = await this.map.reverseGeocode(coord);
    if (!address || token !== this.originToken) return; // 그 사이 또 옮겼으면 무시
    this.origin.name = address;
    this.panel.setOriginName(address);
    this.map.setOriginLabel(address);
  }

  async #search(query) {
    this.panel.setSearching(true);
    try {
      this.panel.showSearchResults(await this.map.searchPlaces(query));
    } catch (e) {
      this.panel.showStatus(e.message, 'error');
    } finally {
      this.panel.setSearching(false);
    }
  }

  /** 현재 슬라이더 값으로 등고선 갱신 (시간장에서 추출만) → 링 배열 반환 */
  #redraw() {
    if (!this.field) return [];
    const minutes = this.panel.minutes;
    const rings   = this.field.contour(minutes);
    const { fill, stroke } = isochroneColor(minutes, this.cfg.maxMinutes);

    if (rings.length) this.map.drawIsochrone(rings, fill, stroke);
    else              this.map.clearIsochrone();
    this.panel.showLegend(minutes, fill);
    return rings;
  }
}
