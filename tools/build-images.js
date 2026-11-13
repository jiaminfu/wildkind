// 把生成的原图裁切、改名、统一尺寸到 public/assets/img
const path = require('path');
const fs = require('fs');
const { processFile } = require('./pngcrop');

const DIR = path.join(__dirname, '..', 'public', 'assets', 'img');

// [原文件名片段, 输出名, 输出宽, 输出高]
const MAP = [
  ['13-21-35', 'p-necklace-fox-gold', 900, 900],
  ['13-21-59', 'p-bracelet-clover-silver', 900, 900],
  ['13-25-35', 'p-necklace-sun-gold', 900, 900],
  ['13-25-47', 'p-necklace-turtle-silver', 900, 900],
  ['13-26-00', 'p-necklace-pearl-gold', 900, 900],
  ['13-26-12', 'p-earrings-hoop-gold', 900, 900],
  ['13-26-31', 'p-rings-stack-gold', 900, 900],
  ['13-26-43', 'p-anklet-shell-gold', 900, 900],
  ['13-27-04', 'p-bracelet-beaded-gold', 900, 900],
  ['13-27-16', 'p-necklace-moon-silver', 900, 900],
  ['13-27-29', 'hero-necklaces', 1100, 1375],
  ['13-27-41', 'c-ocean', 820, 820],
  ['13-27-53', 'c-woodland', 820, 820],
  ['13-28-06', 'c-celestial', 820, 820],
];

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png') && !f.includes('.crop'));
const out = [];
for (const [needle, name, w, h] of MAP) {
  const src = files.find((f) => f.includes(needle));
  if (!src) { out.push({ miss: needle }); continue; }
  try {
    const r = processFile(path.join(DIR, src), path.join(DIR, name + '.png'), { outW: w, outH: h, keepRatio: 0.87 });
    out.push({ name, ...r, kb: Math.round(fs.statSync(path.join(DIR, name + '.png')).size / 1024) });
  } catch (e) {
    out.push({ name, error: e.message });
  }
}
// 清掉原图与中间产物
for (const f of files) {
  if (/^(High_end|Premium_jewelry|Lifestyle_jewelry|Minimal_flat)/.test(f)) {
    try { fs.unlinkSync(path.join(DIR, f)); } catch {}
  }
}
console.log(JSON.stringify(out, null, 1));
