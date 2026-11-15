/* 把原型商品价格从 $42–$96 上调到 FRD BR-01 的三档区间 $58–$143
 * 依据：$42 起价的贡献毛利约 35%，扣除获客成本后无利；
 *       FRD 的 $58 起价有成本模型支撑，数据应服从定价策略，而非相反。
 * 只改 db.json（源头），之后重新生成 data.js。
 */
const fs = require('fs');
const P = 'data/db.json';
const db = JSON.parse(fs.readFileSync(P, 'utf8'));

// 逐款定价：基础款 58–89 / 珍珠与多层 92–118 / 套装 120–143
const MAP = {
  'LG-401': [48, 64], 'LG-402': [46, 60], 'LG-403': [42, 58], 'LG-404': [44, 62],
  'LG-501': [52, 68], 'LG-502': [46, 62], 'LG-503': [58, 96], 'LG-504': [42, 58], 'LG-505': [44, 60],
  'LG-202': [54, 70], 'LG-203': [46, 60], 'LG-204': [62, 82], 'LG-205': [52, 68],
  'LG-201': [78, 108], 'LG-702': [76, 104],
  'LG-101': [62, 82], 'LG-102': [58, 76], 'LG-103': [64, 84], 'LG-104': [66, 86],
  'LG-105': [72, 94], 'LG-106': [52, 68], 'LG-107': [56, 74], 'LG-108': [48, 64],
  'LG-109': [84, 106], 'LG-701': [66, 86],
  'LG-601': [82, 112], 'LG-801': [96, 143], 'LG-802': [92, 128],
  'LG-301': [54, 70], 'LG-302': [62, 82], 'LG-303': [58, 76], 'LG-304': [56, 74],
  'LG-305': [68, 88], 'LG-602': [68, 104], 'LG-603': [64, 98], 'LG-703': [74, 96]
};

const even = n => Math.round(n / 2) * 2;
let changed = 0;
for (const p of db.products) {
  const m = MAP[p.id];
  if (!m) { console.log('⚠ 未映射', p.id, p.price); continue; }
  const [oldP, newP] = m;
  if (p.price !== oldP) console.log('⚠ ' + p.id + ' 实际 ' + p.price + ' 与表 ' + oldP + ' 不符');
  // 划线价按原折扣比例换算，保持折扣率不变
  const ratio = p.compareAt ? p.compareAt / p.price : null;
  p.price = newP;
  p.compareAt = ratio ? even(newP * ratio) : null;
  if (Array.isArray(p.variants)) {
    p.variants.forEach(v => { if (v.price === oldP) v.price = newP; else if (typeof v.price === 'number') { /* 变体价若独立，按同比例 */ v.price = even(v.price * newP / oldP); } });
  }
  changed++;
}
fs.writeFileSync(P, JSON.stringify(db, null, 2));
const ps = db.products.map(p => p.price).sort((a, b) => a - b);
console.log('已调整', changed, '款；新价格带 $' + ps[0] + '–$' + Math.max(...ps));
const b = {};
ps.forEach(p => { const k = Math.floor(p / 20) * 20; b[k] = (b[k] || 0) + 1; });
console.log('分布(20一档):', JSON.stringify(b));
