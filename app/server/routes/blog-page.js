/* ============================================================
   LASTGROVE · 博客真路径渲染
   ------------------------------------------------------------
   全站唯一的两个真路径：/journal 与 /journal/<slug>。

   为什么只有博客开真路径（Q-01 选 B）：
   SPA 用 hash 路由，# 之后的部分搜索引擎不当独立 URL，
   文章写得再好也拿不到收录。但把全站迁到 history 路由要配 popstate、
   滚动恢复、与 hashchange 互相干扰的判定——那是 SPA 路由 bug 的三大来源。
   只给博客开真路径，用最小改动拿到收录能力，其余继续用 hash。

   渲染顺序要点：这段必须挂在 serveStatic 之前。
   否则 /journal/x 会落进 SPA 兜底分支（内容是 index.html、状态码 404）。
   ============================================================ */
'use strict';
const store = require('../lib/store');
const posts = require('../lib/posts');
const R = require('../../web/assets/js/blog-render');
const Shell = require('../../web/assets/js/shell');

/* 预渲染结果缓存。postsRev 一变整张表作废 ——
   按 slug 精细失效在千级文章量下没有收益，反而多一份状态要维护。 */
let cache = { rev: -1, pages: Object.create(null) };

function validCache() {
  const rev = (store.get().meta || {}).postsRev || 1;
  if (cache.rev !== rev) cache = { rev, pages: Object.create(null) };
  return cache.pages;
}

/* ---------------- 外壳数据 ----------------
   与 /bootstrap 里的 nav 用同一套筛选条件（catalog.js）。两边不一致的话，
   hash 页面与博客页的顶栏会不一样——用户会以为进错了站。 */
function shellData(route) {
  const db = store.get();
  const nav = (db.collections || [])
    .filter(c => c.nav && (c.level || 1) === 1 && c.visible !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(c => ({ handle: c.handle, title: c.title }));
  const collections = (db.collections || [])
    .filter(c => c.visible !== false)
    .map(c => ({ handle: c.handle, title: c.title, parent: c.parent || '' }));
  return {
    nav, collections,
    announce: ((db.settings.content || {}).announce) || '',
    socials: db.settings.socials || {},
    /* 预渲染时没有登录态、没有购物车：一律给 0 和 null，
       前端接管后 bindCommon 会用 localStorage 的真实值补上。 */
    user: null, cartCount: 0, wishCount: 0,
    route: route || {}, isStatic: true,
  };
}

/* ---------------- head ---------------- */
function headBlock(meta, extra) {
  const og = Object.keys(meta.og)
    .map(k => '<meta property="' + k + '" content="' + R.esc(meta.og[k]) + '">')
    .join('\n');
  const tw = Object.keys(meta.twitter)
    .map(k => '<meta name="' + k + '" content="' + R.esc(meta.twitter[k]) + '">')
    .join('\n');

  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + R.esc(meta.title) + '</title>',
    '<meta name="description" content="' + R.esc(meta.description) + '">',
    '<link rel="canonical" href="' + R.esc(meta.canonical) + '">',
    meta.robots ? '<meta name="robots" content="' + R.esc(meta.robots) + '">' : '',
    og,
    tw,
    /* JSON-LD 放 <script type="application/ld+json">，浏览器不当脚本执行，
       所以不需要放宽 CSP 的 script-src。`<` 转义是防正文里的 </script> 提前闭合。 */
    '<script type="application/ld+json">' +
    JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c') + '</script>',
    extra || '',
  ].filter(Boolean).join('\n');
}

/* 预渲染数据只带 kind/slug/meta，不带正文 ——
   正文已经在 #app 里，前端接管时直接从 DOM 取，不重新渲染。
   带正文的话，同一个页面里会出现两份内容，体积翻倍且必然漂移。 */
function boot(ssr) {
  return '<script>window.__LG_SSR__=' +
    JSON.stringify(ssr).replace(/</g, '\\u003c') + ';</script>';
}

function page(meta, body, ssr, o) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    headBlock(meta, o.headHtml) +
    '\n</head>\n<body>\n<div id="app" data-ssr="' + R.esc(ssr.kind) + '">' +
    body +
    '</div>\n' +
    boot(ssr) +
    '\n' + o.jsHtml + '\n</body>\n</html>';
}

/* ---------------- 列表页 ---------------- */
function renderList(o) {
  const q = o.query || {};
  const section = String(q.section || '').trim();
  const list = posts.listPublic({ section, page: q.page, limit: 9 });
  const route = { seg: ['journal'] };

  /* 筛选页与翻页页都 canonical 到 /journal：
     同一批内容不该有多个可索引的地址。筛选页额外加 noindex。 */
  const meta = R.meta({
    title: 'Field Notes',
    slug: '',
    excerpt: 'Materials, workshops, and where the 1% goes. Notes from a small studio making 316L steel jewellery.',
  }, o.origin, { isList: true });
  if (section) meta.robots = 'noindex,follow';
  if (list.meta.page > 1) meta.canonical = o.origin + '/journal?page=' + list.meta.page;

  const secs = list.meta.sections;
  const chips = '<a class="jchip' + (section ? '' : ' is-on') + '" href="/journal">All</a>' +
    secs.map(s => '<a class="jchip' + (section === s ? ' is-on' : '') +
      '" href="/journal?section=' + encodeURIComponent(s) + '">' + R.esc(R.sectionLabel(s)) + '</a>').join('');

  const cards = list.items.length
    ? list.items.map(R.card).join('')
    : '<p class="jempty">Nothing here yet. ' +
      '<a href="/journal">Back to all notes</a>.</p>';

  const qs = (page) => {
    const parts = [];
    if (section) parts.push('section=' + encodeURIComponent(section));
    if (page > 1) parts.push('page=' + page);
    return '/journal' + (parts.length ? '?' + parts.join('&') : '');
  };
  const pager = list.meta.pages > 1
    ? '<nav class="jpager" aria-label="Pages">' +
      (list.meta.page > 1 ? '<a href="' + qs(list.meta.page - 1) + '" rel="prev">← Newer</a>' : '<span></span>') +
      '<span class="jpager__n">Page ' + list.meta.page + ' of ' + list.meta.pages + '</span>' +
      (list.meta.page < list.meta.pages ? '<a href="' + qs(list.meta.page + 1) + '" rel="next">Older →</a>' : '<span></span>') +
      '</nav>'
    : '';

  const body = Shell.header(shellData(route)) +
    '<main id="main">' +
    '<section class="wrap jhead">' +
    '<div class="eyebrow">Journal</div>' +
    '<h1 class="jhead__title">Field notes</h1>' +
    '<p class="jhead__lede">Materials, workshops, and where the 1% goes.</p>' +
    '<nav class="jchips" aria-label="Sections">' + chips + '</nav>' +
    '</section>' +
    '<div class="wrap"><div class="jgrid">' + cards + '</div>' + pager + '</div>' +
    '</main>' +
    Shell.footer(shellData(null));

  return page(meta, body, { kind: 'journal', slug: null, meta }, o);
}

/* ---------------- 详情页 ---------------- */
function renderPost(post, o) {
  const route = { seg: ['journal'] };
  const meta = R.meta(post, o.origin);

  const body = Shell.header(shellData(route)) +
    '<main id="main">' + R.article(post, { origin: o.origin }) + '</main>' +
    Shell.footer(shellData(null));

  return page(meta, body, { kind: 'post', slug: post.slug, meta }, o);
}

/* ---------------- 404 ----------------
   草稿与不存在必须是完全同一种响应：同状态码、同正文、同样的措辞。
   区分开就等于告诉外人「这里有一篇没写完的文章」。 */
function render404(o) {
  const meta = {
    title: 'Page not found — LASTGROVE',
    description: 'That page does not exist.',
    canonical: o.origin + '/journal',
    robots: 'noindex,follow',
    og: { 'og:type': 'website', 'og:title': 'Page not found — LASTGROVE', 'og:url': o.origin + '/journal' },
    twitter: { 'twitter:card': 'summary' },
    jsonLd: null,
  };
  const body = Shell.header(shellData({ seg: ['journal'] })) +
    '<main id="main"><section class="wrap jhead">' +
    '<div class="eyebrow">404</div>' +
    '<h1 class="jhead__title">Page not found</h1>' +
    '<p class="jhead__lede">That article does not exist, or it is no longer published.</p>' +
    '<p><a class="btn" href="/journal">Read the journal</a></p>' +
    '</section></main>' +
    Shell.footer(shellData(null));

  const html = page(meta, body, { kind: 'notfound', slug: null, meta: null }, o);
  return html;
}

/* ---------------- 响应 ---------------- */
function sendHtml(req, res, html, etag, status) {
  const inm = String(req.headers['if-none-match'] || '');
  if (status === 200 && etag && inm && inm === etag) {
    res.writeHead(304, {
      'ETag': etag,
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
    return res.end();
  }
  const raw = Buffer.from(html);
  const gz = require('zlib').gzipSync(raw, { level: 6 });
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': res.__csp || '',
  };
  if (etag) headers['ETag'] = etag;
  const useGz = String(req.headers['accept-encoding'] || '').indexOf('gzip') >= 0;
  const out = useGz ? gz : raw;
  headers['Content-Length'] = out.length;
  if (useGz) { headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding'; }
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
}

/* ---------------- 入口 ----------------
   o = { pathname, query, origin, headHtml, jsHtml, csp } */
function handle(req, res, o) {
  res.__csp = o.csp;
  const path = o.pathname;

  /* 尾斜杠 301 而不是两个都 200：/journal/a 和 /journal/a/ 内容相同，
     两个都返回 200 就是重复内容，权重被摊薄。 */
  if (path.length > 1 && path.charAt(path.length - 1) === '/') {
    const qs = Object.keys(o.query || {}).length
      ? '?' + new URLSearchParams(o.query).toString() : '';
    res.writeHead(301, { 'Location': path.replace(/\/+$/, '') + qs, 'Content-Length': 0 });
    return res.end();
  }

  const pages = validCache();
  const rev = cache.rev;

  if (path === '/journal') {
    const q = o.query || {};
    const key = 'list|' + String(q.section || '') + '|' + String(q.page || 1);
    const hit = pages[key];
    if (hit) return sendHtml(req, res, hit.html, hit.etag, 200);
    const html = renderList(o);
    const etag = 'W/"' + rev + '-list-' + (q.section || 'all') + '-' + (q.page || 1) + '"';
    pages[key] = { html, etag };
    return sendHtml(req, res, html, etag, 200);
  }

  const slug = path.slice('/journal/'.length);
  if (!slug || slug.indexOf('/') >= 0) return sendHtml(req, res, render404(o), null, 404);

  const post = posts.getPublic(decodeURIComponent(slug));
  if (!post) return sendHtml(req, res, render404(o), null, 404);

  const key = 'post|' + post.slug;
  const hit = pages[key];
  if (hit) return sendHtml(req, res, hit.html, hit.etag, 200);

  const html = renderPost(post, o);
  const etag = 'W/"' + rev + '-' + post.slug + '-' +
    String(post.updatedAt || '').replace(/[^0-9]/g, '').slice(0, 14) + '"';
  pages[key] = { html, etag };
  sendHtml(req, res, html, etag, 200);
}

module.exports = { handle, shellData };
