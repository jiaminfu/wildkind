/* HTML → Markdown 转换器（零依赖）
   用途：把 review/ 与 branding/ 下已有的定稿 HTML 文档批量转成 Markdown，
   统一落到 handover/，方便用户在一个文件夹里检索和全文搜索。
   只覆盖本项目文档用到的结构，不做通用实现：
     .cover / .meta / h1-h4 / p / ul / ol / pre / code / table / .note / .demo-box / blockquote
   用法：node tools/html2md.js <输入.html> [输出.md]
        node tools/html2md.js --all      # 批量转换定稿文档 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------------- 实体与行内元素 ---------------- */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©',
  mdash: '—', ndash: '–', hellip: '…', times: '×', middot: '·', rarr: '→',
  larr: '←', uarr: '↑', darr: '↓', check: '✓', cross: '✗', deg: '°',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  sup2: '²', sup3: '³', frac12: '½', yen: '¥', euro: '€', pound: '£',
};

function decode(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => (ENTITIES[n] != null ? ENTITIES[n] : m));
}

/** 行内元素 → Markdown。ctx 里带 inTable 时对竖线做转义，否则会把表格列切坏 */
function inline(html, ctx) {
  ctx = ctx || {};
  let s = html;

  // 行内 code 先抽出来，避免其中内容被后续规则改写
  const codes = [];
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => {
    const v = decode(stripTags(inner)).trim();
    codes.push(v);
    return '\u0000C' + (codes.length - 1) + '\u0000';
  });

  s = s.replace(/<br\s*\/?>/gi, ' ');
  // .hl 高亮 → 加粗，保留「本版重点」的语义
  s = s.replace(/<span\b([^>]*)class=["'][^"']*\bhl\b[^"']*["']([^>]*)>([\s\S]*?)<\/span>/gi,
    (_, __, ___, t) => '**' + decode(stripTags(t)).trim() + '**');
  s = s.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => {
    const t = decode(stripTags(txt)).trim();
    if (!t) return '';
    if (!href || href === '#') return t;
    return '[' + t + '](' + href + ')';
  });
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => '**' + decode(stripTags(t)).trim() + '**');
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => {
    const v = decode(stripTags(t)).trim();
    return v ? '*' + v + '*' : '';
  });

  s = stripTags(s);
  s = decode(s);
  // 折叠空白，但保留 \u0000 占位符
  s = s.replace(/\s+/g, ' ');

  s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => {
    const v = codes[Number(i)];
    if (!v) return '';
    // 内容本身带反引号时用双反引号包裹
    const fence = v.indexOf('`') >= 0 ? '``' : '`';
    return fence + v + fence;
  });

  if (ctx.inTable) s = s.replace(/\|/g, '\\|');
  return s.trim();
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

/* ---------------- 块级解析 ---------------- */

const BLOCK_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'ul', 'ol', 'pre', 'table', 'blockquote', 'div', 'hr', 'figure'];

/** 从 from 处找 <tag ...>...</tag>，用深度计数处理同名嵌套 */
function takeTag(html, tag, from) {
  const open = new RegExp('<' + tag + '\\b[^>]*>', 'i');
  const m = open.exec(html.slice(from));
  if (!m) return null;
  const start = from + m.index;
  const afterOpen = start + m[0].length;
  if (/\/>$/.test(m[0])) return { start, end: afterOpen, inner: '', attrs: m[0] };
  if (tag === 'hr') return { start, end: afterOpen, inner: '', attrs: m[0] };

  const re = new RegExp('<' + tag + '\\b[^>]*>|</' + tag + '>', 'gi');
  re.lastIndex = afterOpen;
  let depth = 1, t;
  while ((t = re.exec(html))) {
    if (t[0][1] === '/') {
      depth--;
      if (depth === 0) {
        return { start, end: re.lastIndex, inner: html.slice(afterOpen, t.index), attrs: m[0] };
      }
    } else {
      depth++;
    }
  }
  return { start, end: html.length, inner: html.slice(afterOpen), attrs: m[0] };
}

function classOf(attrs) {
  const m = /class=["']([^"']*)["']/i.exec(attrs || '');
  return m ? m[1] : '';
}

/** 表格 → GitHub 风格 Markdown 表 */
function tableToMd(html) {
  const rows = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cells = [];
    const cre = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cre.exec(m[1]))) {
      cells.push({
        head: c[1].toLowerCase() === 'th',
        num: /class=["'][^"']*\bnum\b/.test(c[2]),
        text: inline(c[3], { inTable: true }).replace(/\n/g, ' '),
      });
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return '';

  const width = Math.max(...rows.map(r => r.length));
  const pad = r => {
    const out = r.map(c => c.text);
    while (out.length < width) out.push('');
    return out;
  };

  const header = rows[0].every(c => c.head) ? rows[0] : null;
  const body = header ? rows.slice(1) : rows;
  const headLine = header ? pad(header) : new Array(width).fill('');

  const align = new Array(width).fill('---');
  if (header) header.forEach((c, i) => { if (c.num) align[i] = '---:'; });

  const lines = [];
  lines.push('| ' + headLine.join(' | ') + ' |');
  lines.push('| ' + align.join(' | ') + ' |');
  body.forEach(r => lines.push('| ' + pad(r).join(' | ') + ' |'));
  return lines.join('\n');
}

function listToMd(html, ordered) {
  const items = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m, n = 0;
  while ((m = re.exec(html))) {
    n++;
    const text = inline(m[1]);
    if (!text) continue;
    items.push((ordered ? n + '. ' : '- ') + text);
  }
  return items.join('\n');
}

function preToMd(html) {
  const m = /class=["'](?:[^"']*\s)?(?:lang(?:uage)?-|language-)([\w+-]+)/i.exec(html);
  const lang = m ? m[1] : (/^\s*[{[]/.test(stripTags(html)) ? 'json' : '');
  let body = stripTags(html.replace(/<br\s*\/?>/gi, '\n'));
  body = decode(body).replace(/^\n+|\n+$/g, '');
  const fence = body.indexOf('```') >= 0 ? '````' : '```';
  return fence + lang + '\n' + body + '\n' + fence;
}

function metaToMd(html) {
  // .meta 是「标签 / 值」交替的 div 序列
  const cells = [];
  const re = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = inline(m[1]);
    if (t) cells.push(t);
  }
  const lines = [];
  for (let i = 0; i < cells.length; i += 2) {
    const k = cells[i], v = cells[i + 1] || '';
    lines.push('- **' + k + '**：' + v);
  }
  return lines.join('\n');
}

/** 抓取一段 HTML 里所有 <span> 的文本，用于把「盒子图」压成一行 */
function spansOf(html) {
  const out = [];
  const re = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(html))) {
    const isHl = /\bhl\b/.test(classOf(m[1]));
    let t = inline(m[2]);
    if (!t) continue;
    if (isHl) t = '**' + t + '**';
    out.push(t);
  }
  return out;
}

function blocksToMd(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    // 找到最近的块级开始标签
    let best = null;
    for (const tag of BLOCK_TAGS) {
      const idx = html.slice(i).search(new RegExp('<' + tag + '\\b', 'i'));
      if (idx < 0) continue;
      const pos = i + idx;
      if (!best || pos < best.pos) best = { tag, pos };
    }
    if (!best) {
      const tail = inline(html.slice(i));
      if (tail) out.push(tail);
      break;
    }
    // 块前的散落文本
    const lead = inline(html.slice(i, best.pos));
    if (lead) out.push(lead);

    const node = takeTag(html, best.tag, best.pos);
    if (!node) { i = best.pos + 1; continue; }
    i = node.end;

    const cls = classOf(node.attrs);
    const tag = best.tag;

    if (/^h[1-6]$/.test(tag)) {
      const lvl = Number(tag[1]);
      const text = inline(node.inner);
      if (text) out.push('#'.repeat(Math.min(6, lvl)) + ' ' + text);
      continue;
    }
    if (tag === 'p') {
      const text = inline(node.inner);
      if (text) out.push(text);
      continue;
    }
    if (tag === 'hr') { out.push('---'); continue; }
    if (tag === 'table') {
      const t = tableToMd(node.inner);
      if (t) out.push(t);
      continue;
    }
    if (tag === 'pre') { out.push(preToMd(node.inner)); continue; }
    if (tag === 'ul') { const t = listToMd(node.inner, false); if (t) out.push(t); continue; }
    if (tag === 'ol') { const t = listToMd(node.inner, true); if (t) out.push(t); continue; }
    if (tag === 'blockquote') {
      const t = blocksToMd(node.inner);
      if (t) out.push(t.split('\n').map(l => '> ' + l).join('\n'));
      continue;
    }
    if (tag === 'figure') { const t = blocksToMd(node.inner); if (t) out.push(t); continue; }

    // div：按 class 决定语义
    if (/cover/.test(cls)) {
      const t = blocksToMd(node.inner);
      if (t) out.push(t);
      continue;
    }
    if (/\bmeta\b/.test(cls)) {
      const t = metaToMd(node.inner);
      if (t) out.push(t);
      continue;
    }
    if (/note|demo-box|callout|tip|warn/.test(cls)) {
      const t = blocksToMd(node.inner);
      if (t) out.push(t.split('\n').map(l => '> ' + l).join('\n'));
      continue;
    }
    // 分层架构图：.stack > .layer > b + .boxes > span
    // 原样拍平会把「Cloudflare / CDN」和「HTTPS」粘成一个词，所以按层压成列表项
    if (/\bstack\b/.test(cls)) {
      out.push(stackToMd(node.inner));
      continue;
    }
    if (/\blayer\b/.test(cls)) {
      out.push('-' + layerToMd(node.inner));
      continue;
    }
    // 导航条目那种「·分隔的一行」：span 与 <i>·</i> 交错，直接取 span 再用 · 连
    if (/\bflow\b/.test(cls)) {
      const items = spansOf(node.inner);
      if (items.length) out.push(items.join(' · '));
      continue;
    }
    // 其余 div 继续下钻
    const t = blocksToMd(node.inner);
    if (t) out.push(t);
    continue;
  }
  return out.join('\n\n');
}

/** .stack → 每层一行列表项 */
function stackToMd(html) {
  const lines = [];
  const re = /<div\b([^>]*)>([\s\S]*?)<\/div>\s*(?=<div\b|$)/gi;
  let m;
  // 逐层解析：用 takeTag 保证嵌套正确
  let i = 0;
  while (i < html.length) {
    const node = takeTag(html, 'div', i);
    if (!node) break;
    i = node.end;
    if (/\blayer\b/.test(classOf(node.attrs))) {
      lines.push('-' + layerToMd(node.inner));
    }
  }
  return lines.join('\n');
}

/** .layer 内层：<b>层名</b> + .boxes 里的 span 列表 */
function layerToMd(html) {
  const nm = /<b\b[^>]*>([\s\S]*?)<\/b>/i.exec(html);
  const name = nm ? inline(nm[1]) : '';
  const boxes = /<div\b[^>]*class=["'][^"']*\bboxes\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const items = boxes ? spansOf(boxes[1]) : spansOf(html);
  if (!items.length) return ' **' + name + '**';
  return ' **' + name + '**：' + items.join(' · ');
}

/* ---------------- 入口 ---------------- */

function convert(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, '');
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, '');   // 左侧目录：Markdown 侧栏没意义，标题层级已能导航
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  const main = /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(s);
  if (main) s = main[1];
  else {
    const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(s);
    if (body) s = body[1];
  }

  // 标题编号用的是 <span class="n">2</span>架构总览，
  // 直接剥标签会得到「2架构总览」，这里补一个空格
  s = s.replace(/<span\b[^>]*class=["'][^"']*\bn\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '$1 ');
  // .hl 是「本版新增/重点」的视觉高亮，交给 inline() 转加粗，
  // 不能在全局替换成 <b>——分层图里的 span 要靠 spansOf 逐项识别

  let md = blocksToMd(s);
  md = md
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 去掉空表头（无 th 的表格首行被当作表头时会出现全空表头）
  md = md.replace(/^\|\s*(\|\s*)+\|\n\|[\s:|-]+\|\n/gm, '');
  return md + '\n';
}

/* 批量清单：每个文档只取最新定稿版，历史版本不重复转，
   版本演进在 handover/00-概览/版本演进记录.md 里以表格形式保留。 */
const BATCH = [
  ['review/FRD-功能需求说明书-v2.5.html', 'handover/01-产品需求/FRD-功能需求说明书-v2.5.md'],
  ['review/SDD-系统设计说明书-v2.3.html', 'handover/02-系统设计/SDD-系统设计说明书-v2.3.md'],
  ['review/UI设计说明书-v1.2.html', 'handover/03-UI与品牌/UI设计说明书-v1.2.md'],
  ['branding/TIDEGLASS品牌方案-v2.1.html', 'handover/03-UI与品牌/品牌方案-v2.1.md'],
  // 原型-线框图 不转 Markdown：它的主体是灰块+线条的视觉稿，
  // 转成文字会退化成无法阅读的碎片，且其中品牌名仍是更名前的 Wildkind。
  // 原型交付方式见 handover/06-原型/原型说明.md（在线地址 + 截图）。
  ['review/同步核查报告-v1.0.html', 'handover/08-评审与核查/同步核查报告-v1.0.md'],
  ['review/架构闭环评估-v1.0.html', 'handover/08-评审与核查/架构闭环评估-v1.0.md'],
  ['review/评审意见-FRD与SDD审核-v1.0.html', 'handover/08-评审与核查/评审意见-FRD与SDD审核-v1.0.md'],
  ['review/运营建议意见稿-v1.0.html', 'handover/08-评审与核查/运营建议意见稿-v1.0.md'],
  ['review/运营意见评审记录-v1.0.html', 'handover/08-评审与核查/运营意见评审记录-v1.0.md'],
];

function writeOne(inRel, outRel) {
  const src = path.join(ROOT, inRel);
  if (!fs.existsSync(src)) { console.log('  跳过（不存在）' + inRel); return false; }
  const md = convert(fs.readFileSync(src, 'utf8'));
  const dst = path.join(ROOT, outRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const banner = '<!-- 由 tools/html2md.js 从 ' + path.basename(inRel) + ' 自动转换；' +
    '内容与源 HTML 一致，如需修改请改源文件后重新生成 -->\n\n';
  fs.writeFileSync(dst, banner + md, 'utf8');
  const kb = (Buffer.byteLength(md, 'utf8') / 1024).toFixed(1);
  console.log('  ✓ ' + outRel + '  (' + kb + ' KB, ' + md.split('\n').length + ' 行)');
  return true;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--all') {
    console.log('批量转换：');
    let n = 0;
    BATCH.forEach(([i, o]) => { if (writeOne(i, o)) n++; });
    console.log('完成 ' + n + ' 个文档');
  } else if (args.length >= 1) {
    const src = args[0];
    const dst = args[1] || src.replace(/\.html?$/i, '.md');
    const md = convert(fs.readFileSync(src, 'utf8'));
    fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
    fs.writeFileSync(dst, md, 'utf8');
    console.log('已转换 → ' + dst);
  } else {
    console.log('用法：node tools/html2md.js <输入.html> [输出.md] | --all');
  }
}

module.exports = { convert };
