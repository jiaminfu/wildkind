// 一次性品牌替换：TIDEGLASS → LASTGROVE（数据层）
//
// 与 rebrand-code.js 的区别：这里除了字符串替换，还要
//   1) 重算员工口令哈希（scrypt，salt 重生成）—— 口令本身从 tideglass* 变 lastgrove*
//   2) 改 SKU 前缀 TG- → LG-（products / orders / reviews / quotes / stockLedger 全链一致）
//   3) 重写 settings.brand / tagline / content（hero 文案按 LG-BR-001 定稿）
//
// 用法：node tools/rebrand-data.js --dry  |  node tools/rebrand-data.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const FILES = ['app/server/data/db.json', 'app/server/data/db.seed.json'];

// 与 app/server/lib/auth.js 的 hashPassword 保持逐字节一致
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

const CREDS = {
  'owner@lastgrove.com': 'lastgrove2026',
  'ops@lastgrove.com': 'lastgrove-ops',
};

// 品牌与文案（LG-BR-001 v1.0 定稿 + 合规修正）
const BRAND = 'LASTGROVE';
const TAGLINE = 'Grows on you.';
const CONTENT = {
  announce: 'Free shipping over $95 · 30-day returns · Duties included',
  heroEyebrow: '316L stainless · Two finishes',
  heroTitle: 'Small runs.|No occasion required.',
  heroBody: '316L stainless steel, made in short runs. Silver pieces are unplated — the colour is the metal itself. Gold pieces are 18k gold PVD over 316L. Water, sweat, sleep: they come out the way they went in.',
};

// 递归替换字符串值（不动 key）
function deepReplace(v) {
  if (typeof v === 'string') return v
    .replace(/tideglassjewelry\.com/gi, 'lastgrove.com')
    .replace(/tideglass/gi, 'lastgrove')
    .replace(/\bTG-(?=\d)/g, 'LG-');
  if (Array.isArray(v)) return v.map(deepReplace);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = deepReplace(v[k]);
    return o;
  }
  return v;
}

let sum = 0;
for (const rel of FILES) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) { console.log('跳过（不存在）', rel); continue; }

  const db = JSON.parse(fs.readFileSync(f, 'utf8'));
  const before = JSON.stringify(db);
  let d = deepReplace(db);

  // ---- settings ----
  d.settings.brand = BRAND;
  d.settings.tagline = TAGLINE;
  d.settings.content = Object.assign({}, d.settings.content, CONTENT);

  // ---- 员工：邮箱已由 deepReplace 改掉，这里重算口令 ----
  for (const s of d.staff || []) {
    const pw = CREDS[s.email];
    if (!pw) { console.log('⚠ 未知账号，口令未动:', s.email); continue; }
    const { salt, hash } = hashPassword(pw);
    s.salt = salt;
    s.hash = hash;
  }

  // ---- 优惠码：deepReplace 已把 TIDEGLASS10 改成小写 lastgrove10，这里补回大写 ----
  for (const c of d.coupons || []) {
    if (/^lastgrove10$/i.test(c.code)) c.code = 'LASTGROVE10';
  }

  const after = JSON.stringify(d);
  const hits = before === after ? 0 : 1;
  sum += hits;

  if (!DRY) fs.writeFileSync(f, JSON.stringify(d, null, 1));
  console.log(`${DRY ? '[DRY] ' : ''}${rel} — brand=${d.settings.brand} tagline="${d.settings.tagline}" staff=${(d.staff || []).map(s => s.email).join(',')} coupons=${(d.coupons || []).map(c => c.code).join(',')}`);
}

// 统计替换量
console.log('\n剩余检查：');
for (const rel of FILES) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const tdl = (s.match(/tideglass/gi) || []).length;
  const tg = (s.match(/\bTG-(?=\d)/g) || []).length;
  console.log(`  ${rel}: tideglass=${tdl}  TG-=${tg}`);
}
console.log(`\n${DRY ? '[DRY] ' : ''}处理 ${FILES.length} 个文件`);
