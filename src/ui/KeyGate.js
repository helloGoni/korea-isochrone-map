/**
 * 카카오 JS 키 입력 화면
 *
 * - 기본 키(config.js)나 저장된 키가 있으면 화면을 띄우지 않고 바로 지도를 엽니다.
 * - 입력란은 비밀번호 형식이며, 기본 키·저장된 키를 입력란에 채워 보여주지 않습니다.
 * - 키를 비우고 제출하면 저장된 키를 지우고 기본 키로 돌아갑니다.
 */

const STORAGE_KEY = 'kakao_js_key';

export class KeyGate {
  /**
   * @param {{ builtinKey?: string, onSubmit: (key: string) => void }} opts
   */
  constructor({ builtinKey = '', onSubmit }) {
    this.builtinKey = builtinKey;
    this.onSubmit   = onSubmit;

    const $ = id => document.getElementById(id);
    this.el      = $('api-key-panel');
    this.input   = $('input-js-key');
    this.button  = $('btn-apply-keys');
    this.errorEl = $('key-error');
    this.hintEl  = $('key-builtin-hint');
    this.cancel  = $('btn-cancel-key');

    this.button.addEventListener('click', () => this.#submit());
    this.cancel.addEventListener('click', () => this.hide());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.#submit();
      if (e.key === 'Escape' && !this.cancel.classList.contains('hidden')) this.hide();
    });
  }

  /** 사용할 키: 사용자가 직접 저장한 키 > config.js 기본 키 */
  get currentKey() { return this.#savedKey || this.builtinKey; }

  /**
   * @param {string} [errorMessage]
   * @param {{ cancellable?: boolean }} opts  지도가 이미 열려 있으면 취소 가능
   */
  show(errorMessage, { cancellable = false } = {}) {
    this.input.value       = '';
    this.input.placeholder = this.currentKey ? '•••••••• (설정된 키 사용 중)' : 'JavaScript 앱 키';
    this.hintEl.classList.toggle('hidden', !this.builtinKey);
    this.cancel.classList.toggle('hidden', !cancellable);
    this.setError(errorMessage);
    this.el.classList.remove('hidden');
    this.input.focus();
  }

  hide() { this.el.classList.add('hidden'); }

  setLoading(loading) {
    this.button.disabled    = loading;
    this.button.textContent = loading ? '로딩 중...' : '지도 열기';
  }

  setError(message) {
    this.errorEl.textContent = message ?? '';
    this.errorEl.classList.toggle('hidden', !message);
  }

  #submit() {
    const typed = this.input.value.trim();
    this.input.value = '';
    if (typed) {
      this.#savedKey = typed;
    } else {
      this.#savedKey = '';
      if (!this.builtinKey) { this.setError('카카오 JavaScript 키를 입력해주세요.'); return; }
    }
    this.onSubmit(this.currentKey);
  }

  #memoryKey = ''; // 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 이번 세션에만 사용

  get #savedKey() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return this.#memoryKey; }
  }
  set #savedKey(value) {
    this.#memoryKey = value;
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else       localStorage.removeItem(STORAGE_KEY);
    } catch { /* 위 memoryKey 로 대체 */ }
  }
}
