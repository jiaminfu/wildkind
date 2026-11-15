// LASTGROVE logo 生成器 —— 零依赖，改这里的常量后重跑即可全量更新
//   node tools/gen-lastgrove-logo.js
// 输出：handover/03-UI与品牌/lastgrove/logo/*.svg
//
// 说明：字标使用 <text> + Cormorant Garamond，正式印刷/上线前需在 Figma 或
// Illustrator 里「转曲（create outlines）」，或自托管 woff2，避免字体缺失导致变形。
// 图形 mark 全部是几何 path，不依赖任何字体。

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'handover', '03-UI与品牌', 'lastgrove', 'logo');
fs.mkdirSync(OUT, { recursive: true });

const C = {
  ink:   '#1B2B2E', // 主文字 / logo
  mist:  '#EDF1F0', // 页面底 / 反白
  grove: '#4A7C6F', // 主行动色（原 Verdigris）
  sand:  '#C9B79C', // 次级底
  clay:  '#A85F4B', // 唯一暖色，面积 < 5%
};

// ---- 几何：一枚几乎闭合的环 + 环内一棵小树 + 顶部搭扣点 --------------------
// 缺口在正上方 12 点，跨约 16°；Clay 实心点把两端「扣」上。
const RING = 'M 66.68 12.47 A 48 48 0 1 1 53.32 12.47';
const TREE = 'M 60 103 V 64 M 60 82 L 48 68 M 60 82 L 72 68';

function mark({ ring = C.grove, tree = C.grove, dot = C.clay, sw = 5, withDot = true, withTree = true } = {}) {
  return `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${RING}" stroke="${ring}" stroke-width="${sw}"/>
    ${withTree ? `<path d="${TREE}" stroke="${tree}" stroke-width="${sw}"/>` : ''}
  </g>
  ${withDot ? `<circle cx="60" cy="12.47" r="4.5" fill="${dot}"/>` : ''}`;
}

function markGroup(x = 0, y = 0, scale = 1, opts = {}) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">${mark(opts)}</g>`;
}

function wordmark({ x, y, size = 64, fill = C.ink, anchor = 'start', tracking = 0.6 } = {}) {
  return `<text x="${x}" y="${y}" fill="${fill}" text-anchor="${anchor}"
    font-family="'Cormorant Garamond', Georgia, 'Times New Roman', serif"
    font-size="${size}" font-weight="500" letter-spacing="${tracking}">lastgrove</text>`;
}

function svg(w, h, body, { title = 'Lastgrove', desc = 'Lastgrove brand mark', bg = null } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Lastgrove">
  <title>${title}</title><desc>${desc}</desc>
  ${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}
  ${body}
</svg>
`;
}

const write = (name, content) => {
  fs.writeFileSync(path.join(OUT, name), content, 'utf8');
  console.log('  ' + name);
};

// ---- 1 横版主标 -------------------------------------------------------------
write('lastgrove-primary.svg', svg(560, 140,
  `${markGroup(10, 10)}
   ${wordmark({ x: 178, y: 94, size: 66 })}`,
  { title: 'Lastgrove — primary horizontal lockup', desc: 'Grove green pendant mark with ink lowercase wordmark' }));

// ---- 2 竖版 -----------------------------------------------------------------
write('lastgrove-stacked.svg', svg(400, 300,
  `${markGroup(140, 8, 1)}
   ${wordmark({ x: 200, y: 218, size: 58, anchor: 'middle', tracking: 1.2 })}`,
  { title: 'Lastgrove — stacked lockup', desc: 'Mark above centered wordmark' }));

// ---- 3 图形 mark 彩色 -------------------------------------------------------
write('lastgrove-mark.svg', svg(120, 120,
  `${mark()}`,
  { title: 'Lastgrove — symbol', desc: 'An almost-closed ring with a small tree inside and a clay clasp dot' }));

// ---- 4 图形 mark 单色（激光刻 / 压印 / 传真） -------------------------------
write('lastgrove-mark-mono.svg', svg(120, 120,
  `${mark({ ring: C.ink, tree: C.ink, dot: C.ink })}`,
  { title: 'Lastgrove — mono symbol', desc: 'Single-colour version for embossing and engraving' }));

// ---- 5 深底反白横版 ---------------------------------------------------------
write('lastgrove-reverse.svg', svg(560, 140,
  `${markGroup(10, 10, 1, { ring: C.mist, tree: C.mist, dot: C.clay })}
   ${wordmark({ x: 178, y: 94, size: 66, fill: C.mist })}`,
  { title: 'Lastgrove — reverse lockup', desc: 'Light-on-dark version', bg: C.ink }));

// ---- 6 Favicon（16px 可辨，去掉搭扣点） ------------------------------------
write('lastgrove-favicon.svg', svg(64, 64,
  `<rect width="64" height="64" rx="13" fill="${C.ink}"/>
   <g transform="translate(2 2) scale(0.5)" fill="none" stroke="${C.mist}"
      stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
     <circle cx="60" cy="60" r="45"/>
     <path d="${TREE}"/>
   </g>`,
  { title: 'Lastgrove — favicon', desc: 'Simplified ring and tree, legible at 16px' }));

// ---- 7 备选方向 B / C -------------------------------------------------------
function directionB(color = C.grove) {
  // 三棵树冠 + 主干 + 地平线：grove = 一片林子
  return `<g fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="30" cy="48" r="12"/><circle cx="60" cy="40" r="15"/><circle cx="90" cy="48" r="12"/>
    <path d="M30 60 V90 M60 55 V90 M90 60 V90"/>
    <path d="M10 93 H110"/>
  </g>`;
}

function directionC(color = C.grove) {
  // 三道年轮 + 顶部一点：last = 经年
  return `<g fill="none" stroke="${color}" stroke-linecap="round">
    <circle cx="60" cy="60" r="44" stroke-width="5"/>
    <circle cx="60" cy="60" r="30" stroke-width="4"/>
    <circle cx="60" cy="60" r="16" stroke-width="3"/>
  </g>
  <circle cx="60" cy="16" r="4.5" fill="${C.clay}"/>`;
}

// ---- 8 三方向对比小样 -------------------------------------------------------
const optionCol = (x, letter, label, note, inner, recommended) => `
  <g transform="translate(${x} 0)">
    <rect x="0" y="0" width="280" height="330" rx="14" fill="${C.mist}"/>
    ${recommended ? `<rect x="0" y="0" width="280" height="4" rx="2" fill="${C.clay}"/>` : ''}
    <g transform="translate(80 34) scale(1)">${inner}</g>
    <text x="140" y="196" text-anchor="middle" fill="${C.ink}"
      font-family="Inter, Arial, sans-serif" font-size="17" font-weight="600">${letter} · ${label}</text>
    <text x="140" y="224" text-anchor="middle" fill="#5B6B6C"
      font-family="Inter, Arial, sans-serif" font-size="12.5">${note}</text>
    ${recommended ? `<text x="140" y="262" text-anchor="middle" fill="${C.clay}"
      font-family="Inter, Arial, sans-serif" font-size="12" font-weight="600" letter-spacing="1.4">RECOMMENDED</text>` : ''}
  </g>`;

write('lastgrove-options.svg', svg(900, 360,
  `${optionCol(0,  'A', 'THE PENDANT', 'ring + tree + clasp', mark(), true)}
   ${optionCol(310, 'B', 'THE GROVE', 'three trees + horizon', directionB(), false)}
   ${optionCol(620, 'C', 'THE RINGS', 'growth rings', directionC(), false)}`,
  { title: 'Lastgrove — three logo directions', desc: 'Direction A is recommended', bg: '#FFFFFF' }));

// ---- 9 全变体 contact sheet -------------------------------------------------
const sheet = svg(900, 720, `
  <text x="40" y="46" fill="${C.ink}" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="600">LASTGROVE · LOGO SYSTEM v1.0</text>
  <text x="40" y="70" fill="#5B6B6C" font-family="Inter, Arial, sans-serif" font-size="12">Ink #1B2B2E · Mist #EDF1F0 · Grove #4A7C6F · Clay #A85F4B</text>

  <rect x="40" y="92" width="820" height="220" rx="12" fill="${C.mist}"/>
  <g transform="translate(180 130) scale(1.2)">${markGroup(0, 0, 1)}${wordmark({ x: 168, y: 84, size: 64 })}</g>
  <text x="60" y="296" fill="#5B6B6C" font-family="Inter, Arial, sans-serif" font-size="12">01 · Primary horizontal</text>

  <rect x="40" y="328" width="392" height="220" rx="12" fill="${C.mist}"/>
  <g transform="translate(110 342) scale(0.72)">${markGroup(0, 0, 1)}</g>
  <g transform="translate(240 342) scale(0.72)">${mark({ ring: C.ink, tree: C.ink, dot: C.ink })}</g>
  <text x="60" y="530" fill="#5B6B6C" font-family="Inter, Arial, sans-serif" font-size="12">02 · Symbol (colour / mono)</text>

  <rect x="448" y="328" width="412" height="220" rx="12" fill="${C.ink}"/>
  <g transform="translate(478 362) scale(0.78)">${markGroup(0, 0, 1, { ring: C.mist, tree: C.mist, dot: C.clay })}${wordmark({ x: 168, y: 84, size: 64, fill: C.mist })}</g>
  <text x="468" y="530" fill="#9FB0AE" font-family="Inter, Arial, sans-serif" font-size="12">03 · Reverse on Ink</text>

  <rect x="40" y="564" width="820" height="126" rx="12" fill="${C.mist}"/>
  <g transform="translate(76 578) scale(0.78)">${markGroup(0, 0, 1)}</g>
  <g transform="translate(207 610) scale(1)">${wordmark({ x: 0, y: 0, size: 46 })}</g>
  <g transform="translate(560 578) scale(0.78)">${directionB()}</g>
  <g transform="translate(716 578) scale(0.78)">${directionC()}</g>
  <text x="60" y="676" fill="#5B6B6C" font-family="Inter, Arial, sans-serif" font-size="12">04 · Mark + wordmark spacing · 05 / 06 · Alternate directions B / C</text>`,
  { title: 'Lastgrove — logo system contact sheet', desc: 'All lockups, colour ways and alternate directions', bg: '#FFFFFF' });

write('lastgrove-sheet.svg', sheet);

console.log('\n输出目录: ' + OUT);
console.log('共 8 个 SVG。字标为 <text>，正式交付前请转曲。');
