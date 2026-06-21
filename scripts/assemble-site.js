/**
 * 배포용 정적 사이트 조립 (GitHub Pages / Vercel / Netlify 공통)
 *
 * - public/ 에 index.html, src/*, data/transit-graph.json 을 모은다.
 * - src/config.js 는 커밋되지 않으므로 환경변수로 생성한다.
 *
 * 환경변수:
 *   KAKAO_JS_KEY (필수)  — 카카오 JavaScript 키
 *   MAX_MINUTES  (선택)  — 기본 120
 *   GRID_CELL_M  (선택)  — 기본 100
 *
 * 사용: node scripts/assemble-site.js   (출력 디렉터리: public/)
 */

const fs   = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out  = path.join(root, 'public');

// 0. 깨끗하게 비우고 시작
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'src'),  { recursive: true });
fs.mkdirSync(path.join(out, 'data'), { recursive: true });

// 1. index.html
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));

// 2. src/* (단, config.js 는 환경변수로 따로 생성)
for (const f of fs.readdirSync(path.join(root, 'src'))) {
  if (f === 'config.js') continue;
  fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'src', f));
}

// 3. config.js 생성 (환경변수에서 키 주입)
const jsKey  = process.env.KAKAO_JS_KEY || '';
const maxMin = process.env.MAX_MINUTES  || '120';
const cellM  = process.env.GRID_CELL_M  || '100';
fs.writeFileSync(
  path.join(out, 'src', 'config.js'),
  `export const KAKAO_JS_KEY = '${jsKey}';\n` +
  `export const MAX_MINUTES = ${maxMin};\n` +
  `export const GRID_CELL_M = ${cellM};\n`
);

// 4. data/transit-graph.json (저장소에 포함된 빌드 산출물)
const graph = path.join(root, 'data', 'transit-graph.json');
if (!fs.existsSync(graph)) {
  console.error('❌ data/transit-graph.json 이 없습니다. `npm run build:transit` 을 먼저 실행하세요.');
  process.exit(1);
}
fs.copyFileSync(graph, path.join(out, 'data', 'transit-graph.json'));

console.log('✅ public/ 생성 완료 (index.html + src + data)');
if (!jsKey) console.warn('⚠️  KAKAO_JS_KEY 환경변수가 비어 있습니다. 지도가 로드되지 않을 수 있습니다.');
