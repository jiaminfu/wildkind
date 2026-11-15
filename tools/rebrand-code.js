// 一次性品牌替换：LASTGROVE → LASTGROVE（代码层）
//
// 只处理 app/ 与 tools/ 与 deploy/ 里的文本文件；不碰 handover/、branding/、docs/
// 等历史文档（那些是留档，改了会失真）；数据库（app/server/data/*.json）由
// tools/rebrand-data.js 单独处理，因为那里还涉及口令重算与 SKU 前缀。
//
// 用法：
//   node tools/rebrand-code.js --dry     # 只看要改什么
//   node tools/rebrand-code.js           # 真的改
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

// 顺序不能变：长串先替换，否则 lastgrove.com 会被拆坏
const RULES = [
  ['lastgrove.com', 'lastgrove.com'],
  ['LASTGROVE', 'LASTGROVE'],
  ['Lastgrove', 'Lastgrove'],
  ['lastgrove', 'lastgrove'],
];

const DIRS = ['app/web', 'app/server', 'tools', 'deploy'];
const SKIP_DIR = /node_modules|[\\/]data[\\/]|[\\/]\.git/;
const TEXT_EXT = new Set(['.js', '.css', '.html', '.json', '.conf', '.sh', '.yml', '.yaml', '.md', '.example', '.service', '.txt', '']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => {
  const p = path.join(ROOT, d);
  return fs.existsSync(p) ? walk(p) : [];
}).filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));

let totalHits = 0;
const changed = [];

for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (src.indexOf('lastgrove') < 0 && src.indexOf('LASTGROVE') < 0 && src.indexOf('Lastgrove') < 0) continue;

  let out = src;
  let hits = 0;
  for (const [from, to] of RULES) {
    const n = out.split(from).length - 1;
    if (n) { out = out.split(from).join(to); hits += n; }
  }
  if (!hits) continue;

  totalHits += hits;
  changed.push([path.relative(ROOT, f), hits]);
  if (!DRY) fs.writeFileSync(f, out);
}

changed.sort((a, b) => b[1] - a[1]);
for (const [f, n] of changed) console.log(String(n).padStart(4), f);
console.log(`\n${DRY ? '[DRY] ' : ''}${changed.length} 个文件 · ${totalHits} 处替换`);
