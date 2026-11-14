/* ============================================================
   TIDEGLASS · CSV 读写（批量导入商品用）
   零第三方依赖，RFC 4180 的够用子集：
   逗号分隔、双引号包裹、"" 转义、\r\n 或 \n 换行、忽略 BOM。
   Excel 另存的 CSV 基本落在这个范围内。
   ============================================================ */
'use strict';

/* 逐字符扫描，不用 split(',') —— 描述里一个逗号就能把整行拆错，
   而这类错误在 100 行的表里极难肉眼发现。 */
function parse(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      i++; continue;
    }
    field += c; i++;
  }

  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

const COLUMNS = [
  'group', 'title', 'handle', 'category', 'price', 'cost', 'compareAt',
  'metal', 'sku', 'stock', 'variantPrice', 'desc', 'motif', 'set',
  'badge', 'images', 'collections', 'sizes',
];

/* 模板刻意留空 sizes：英寸符号 " 在 CSV 里要转义成 ""，让店主手写太别扭。
   导入时 16in 会自动规范成 16（前端显示的英寸写法由 normalizeSize 处理）。 */
const SAMPLE = [
  ['moonlit-hare', 'Moonlit Hare Necklace', '', 'necklaces', '76', '19.5', '92',
    'Gold', '', '11', '', 'A hare in mid-leap with a crescent moon tucked behind its ears.',
    'hare', 'woodland', 'New', 'assets/img/opt/p-necklace-fox-gold.jpg',
    'necklaces|best-sellers', '16in|18in'],
  ['moonlit-hare', 'Moonlit Hare Necklace', '', 'necklaces', '76', '19.5', '92',
    'Silver', '', '10', '', '', 'hare', 'woodland', 'New', '', '', ''],
];

/* Excel 双击打开 CSV 时，没有 BOM 会把中文认成 GBK 而乱码。
   只在字节层加 \uFEFF，不进数据。 */
function template() {
  return '\uFEFF' + toCsv([COLUMNS].concat(SAMPLE));
}

/* 英寸写法归一：16in / 16IN / 16" → 16" */
function normalizeSize(s) {
  const v = String(s || '').trim();
  const m = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/i.exec(v);
  return m ? m[1] + '"' : v;
}

module.exports = { parse, toCsv, COLUMNS, template, normalizeSize };
