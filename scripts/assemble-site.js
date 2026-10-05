/**
 * 배포용 정적 사이트 조립 (GitHub Pages / Vercel / Netlify 공통)
 *
 * - public/ 에 index.html, src/**, data/** (원본 PBF 제외) 를 모은다.
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
fs.mkdirSync(out, { recursive: true });

// 1. index.html
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));

// 2. src/** (단, 로컬 config.js 는 환경변수로 따로 생성)
fs.cpSync(path.join(root, 'src'), path.join(out, 'src'), {
  recursive: true,
  filter: src => path.relative(path.join(root, 'src'), src) !== 'config.js',
});

// 3. config.js 생성 (환경변수에서 키 주입)
const jsKey  = process.env.KAKAO_JS_KEY || '';
const maxMin = process.env.MAX_MINUTES  || '120';
const cellM  = process.env.GRID_CELL_M  || '100';
fs.writeFileSync(
  path.join(out, 'src', 'config.js'),
  `export const KAKAO_JS_KEY = ${JSON.stringify(jsKey)};\n` +
  `export const MAX_MINUTES = ${Number(maxMin) || 120};\n` +
  `export const GRID_CELL_M = ${Number(cellM) || 100};\n`
);

// 4. data/** — sources.json 과 거기 등록된 데이터 파일들 (대용량 원본 PBF 제외)
const manifest = path.join(root, 'data', 'sources.json');
if (!fs.existsSync(manifest)) {
  console.error('❌ data/sources.json 이 없습니다.');
  process.exit(1);
}
fs.cpSync(path.join(root, 'data'), path.join(out, 'data'), {
  recursive: true,
  filter: src => !src.endsWith('.pbf'),
});

const { sources = [] } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
for (const s of sources.filter(s => s.enabled !== false)) {
  if (!fs.existsSync(path.join(root, 'data', s.url))) {
    console.error(`❌ data/sources.json 에 등록된 파일이 없습니다: data/${s.url}` +
      (s.type === 'graph-json' ? '  (`npm run build:transit` 으로 생성)' : ''));
    process.exit(1);
  }
}

console.log('✅ public/ 생성 완료 (index.html + src + data)');
if (!jsKey) console.warn('⚠️  KAKAO_JS_KEY 환경변수가 비어 있습니다. 첫 화면에서 키를 입력해야 합니다.');
