/**
 * 사이드 패널 — 출발지 검색 · 환승/시간 슬라이더 · 진행 · 범례 · 데이터 안내
 *
 * DOM 만 다루고, 사용자의 조작은 생성자에 넘긴 콜백으로 알립니다.
 */

import { MODE_LABEL } from '../engine/geo.js';

export class ControlPanel {
  /**
   * @param {object} opts
   * @param {number} opts.maxMinutes  표시 시간 슬라이더 최댓값
   * @param {object} opts.on          { search(query), pickPlace(place), compute(), timeChange(min),
   *                                    transferChange(n), changeKey() }
   */
  constructor({ maxMinutes, on }) {
    this.maxMinutes = maxMinutes;
    this.on = on;

    const $ = id => document.getElementById(id);
    this.el = {
      panel:          $('side-panel'),
      address:        $('input-address'),
      btnSearch:      $('btn-search'),
      results:        $('search-results'),
      btnRun:         $('btn-run'),
      progressArea:   $('progress-area'),
      progressBar:    $('progress-bar'),
      progressText:   $('progress-text'),
      timeSlider:     $('time-slider'),
      timeValue:      $('time-value'),
      sliderScale:    $('slider-scale'),
      transferSlider: $('transfer-slider'),
      transferValue:  $('transfer-value'),
      status:         $('status'),
      legend:         $('legend'),
      coverage:       $('coverage-list'),
      btnChangeKey:   $('btn-reset-keys'),
    };

    this.#initTimeSlider();
    this.#bindEvents();
  }

  get minutes()      { return parseInt(this.el.timeSlider.value, 10); }
  get maxTransfers() { return parseInt(this.el.transferSlider.value, 10); }

  show() { this.el.panel.classList.remove('hidden'); }
  hide() { this.el.panel.classList.add('hidden'); }

  setOriginName(name) { this.el.address.value = name; }

  setRunEnabled(enabled)  { this.el.btnRun.disabled = !enabled; }
  setTimeEnabled(enabled) { this.el.timeSlider.disabled = !enabled; }

  // ── 검색 결과 ─────────────────────────────────────
  showSearchResults(places) {
    const box = this.el.results;
    box.replaceChildren();
    if (!places.length) {
      box.append(resultItem('검색 결과 없음'));
    } else {
      for (const p of places) {
        const item = resultItem(p.name, p.address);
        item.addEventListener('click', () => { this.hideSearchResults(); this.on.pickPlace(p); });
        box.append(item);
      }
    }
    box.classList.remove('hidden');
  }
  hideSearchResults() { this.el.results.classList.add('hidden'); }
  setSearching(busy)  { this.el.btnSearch.disabled = busy; }

  // ── 진행 바 ───────────────────────────────────────
  setProgress(pct, label) {
    this.el.progressArea.classList.remove('hidden');
    this.el.progressBar.style.width = `${pct}%`;
    this.el.progressText.textContent = label;
  }
  clearProgress() {
    this.el.progressArea.classList.add('hidden');
    this.el.progressBar.style.width = '0%';
  }

  // ── 상태 메시지 ───────────────────────────────────
  showStatus(msg, type = 'info') {
    this.el.status.textContent = msg;
    this.el.status.className   = `status ${type}`;
  }
  hideStatus() { this.el.status.classList.add('hidden'); }

  // ── 범례 ──────────────────────────────────────────
  showLegend(minutes, fill) {
    const swatch = Object.assign(document.createElement('div'), { className: 'legend-swatch' });
    swatch.style.background = fill;
    const text = document.createElement('span');
    text.innerHTML = `<b>${minutes}분 이내</b> 도달 영역 · 환승 최대 ${this.maxTransfers}회`;

    const row = Object.assign(document.createElement('div'), { className: 'legend-row' });
    row.append(swatch, text);
    const title = Object.assign(document.createElement('div'), {
      className: 'legend-title', textContent: '대중교통 (버스+지하철)',
    });
    this.el.legend.replaceChildren(title, row);
    this.el.legend.classList.remove('hidden');
  }
  hideLegend() { this.el.legend.classList.add('hidden'); }

  // ── 데이터 안내 ───────────────────────────────────
  /** @param {{ label, routes, modes, note?, error? }[]} sources  TransitNetwork.sources */
  showCoverage(sources) {
    const items = sources.map(s => {
      const li = document.createElement('li');
      if (s.error) {
        li.className   = 'coverage-error';
        li.textContent = `${s.label}: 불러오기 실패 — ${s.error}`;
        return li;
      }
      const modes = Object.entries(s.modes)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${MODE_LABEL[m] ?? m} ${n.toLocaleString()}`)
        .join(' · ');
      const name = Object.assign(document.createElement('b'), { textContent: s.label });
      li.append(name, ` — ${modes || s.routes.toLocaleString()} 노선`);
      if (s.note) li.append(Object.assign(document.createElement('small'), { textContent: s.note }));
      return li;
    });
    this.el.coverage.replaceChildren(...items);
  }
  showCoverageError(message) {
    const li = Object.assign(document.createElement('li'), { className: 'coverage-error', textContent: message });
    this.el.coverage.replaceChildren(li);
  }

  // ── 내부 ──────────────────────────────────────────
  #initTimeSlider() {
    const max = this.maxMinutes;
    const def = Math.round(max / 2 / 5) * 5;
    const { timeSlider, timeValue, sliderScale } = this.el;
    timeSlider.max   = max;
    timeSlider.value = def;
    timeValue.textContent = `${def}분`;
    sliderScale.innerHTML = [0, 0.25, 0.5, 0.75, 1]
      .map((f, i) => `<span>${Math.round(max * f)}${i === 4 ? '분' : ''}</span>`)
      .join('');
  }

  #bindEvents() {
    const { el, on } = this;
    const search = () => {
      const q = el.address.value.trim();
      if (q) on.search(q);
    };
    el.btnSearch.addEventListener('click', search);
    el.address.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

    el.btnRun.addEventListener('click', () => on.compute());

    // 표시 시간: 움직이는 즉시 등고선 재추출 (재계산 없음)
    el.timeSlider.addEventListener('input', () => {
      el.timeValue.textContent = `${this.minutes}분`;
      on.timeChange(this.minutes);
    });

    // 최대 환승: 끄는 중엔 숫자만, 놓으면 다시 계산
    el.transferSlider.addEventListener('input', () => {
      el.transferValue.textContent = `${this.maxTransfers}회`;
    });
    el.transferSlider.addEventListener('change', () => on.transferChange(this.maxTransfers));

    el.btnChangeKey.addEventListener('click', () => on.changeKey());
  }
}

function resultItem(name, address) {
  const item = Object.assign(document.createElement('div'), { className: 'result-item' });
  item.append(Object.assign(document.createElement('div'), { className: 'name', textContent: name }));
  if (address) item.append(Object.assign(document.createElement('div'), { className: 'addr', textContent: address }));
  return item;
}
