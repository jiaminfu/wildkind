/* ============================================================
   LASTGROVE · 博客渲染器
   ============================================================

   一份代码两端跑（SDS D-3）：服务端 require 它生成预渲染 HTML，
   浏览器 <script> 引它生成 hash 路由下的同一份 HTML。
   如果两端各写一份，漂移后的症状是「view-source 是一种正文、
   页面里是另一种」——最难查的一类 bug，而且 SEO 收益直接归零。

   三条硬约束：
   1) 正文永远经过 esc 再解析标记。存的是纯文本块，不是 HTML，
      所以 XSS 面在数据层就被掐掉了，不靠渲染时的侥幸。
   2) 块类型白名单 7 种，非法块静默丢弃而不是抛错 ——
      历史数据脏了不该让整页 500。
   3) meta() 是唯一实现。服务端写进 <head> 的和前端算出来的必须一模一样。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlogRender = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_BLOCKS = 120;
  var MAX_TEXT = 4000;
  var MAX_ITEMS = 20;
  var MAX_ITEM = 400;
  var MAX_ALT = 200;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) : s;
  }

  /* ---------------- 行内标记 ----------------
     只认三种：**粗**、*斜*、[文字](链接)。不支持嵌套，不支持裸 HTML。
     顺序是硬约束：先 esc 整段，再替换标记。反过来就是把 XSS 入口焊死在 CMS 里。

     第三条正则里的 `(^|[^*])` 是为了让 **bold** 不被当成两个 *斜*：
     没有它的话 `**x**` 会被 * 规则先吃掉中间一段，渲染出字面的星号。 */
  function safeUrl(u) {
    var s = String(u == null ? '' : u);
    /* 控制字符一律拒绝。原因不是洁癖：HTML 解析属性值时会剥掉 tab / LF / CR，
       于是 `/\tevil.com` 到浏览器手里变成 `/\evil.com`，再被当成 `//evil.com`
       —— 协议相对 URL，跳到外站。先把这类字符挡在门外，后面的判断才有意义。 */
    if (/[\u0000-\u001F\u007F]/.test(s)) return false;
    if (/^https?:\/\//i.test(s)) return true;
    /* 单斜杠开头的站内路径。显式排除 `//evil.com`（协议相对 URL）
       和 `/\evil.com`（浏览器会把反斜杠当斜杠，同样是协议相对）。 */
    if (/^\/(?![\/\\])/.test(s)) return true;
    return false;
  }

  function inline(raw) {
    var s = esc(raw);
    s = s.replace(/\*\*([^*]{1,200})\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]{1,200})\*(?!\*)/g, '$1<em>$2</em>');
    /* URL 里允许成对的圆括号：`[x](javascript:alert(1))` 这种 payload
       如果按「不吃括号」的规则匹配，只会吃掉 `javascript:alert(1`，
       留下一个孤零零的右括号在正文里。允许一对括号后能完整匹配，
       再由 safeUrl 判否整段降级为纯文本 —— 输出干净，语义也对。 */
    s = s.replace(/\[([^\]]{1,120})\]\(((?:[^()\s]|\([^()\s]*\)){1,300})\)/g, function (m, t, u) {
      /* esc 之后 & 已经变成 &amp;，URL 里的 & 也变了 —— 这不影响浏览器解析，
         但会导致 safeUrl 判断失败吗？不会：http:// 与 / 开头都不含 &。
         含 & 查询串的链接仍然以 http 开头，照常通过。 */
      return safeUrl(u) ? '<a href="' + u + '" rel="noopener">' + t + '</a>' : t;
    });
    return s;
  }

  /* ---------------- 块渲染 ---------------- */
  function renderBlock(b) {
    if (!b || typeof b !== 'object') return '';
    var text = clip(b.text, MAX_TEXT);

    switch (b.type) {
      case 'p':
        return text ? '<p>' + inline(text) + '</p>' : '';
      case 'h2':
        return text ? '<h2>' + inline(text) + '</h2>' : '';
      case 'h3':
        return text ? '<h3>' + inline(text) + '</h3>' : '';
      case 'quote':
        if (!text) return '';
        return '<blockquote><p>' + inline(text) + '</p>' +
          (b.cite ? '<cite>' + esc(clip(b.cite, 120)) + '</cite>' : '') + '</blockquote>';
      case 'ul': {
        var items = (Array.isArray(b.items) ? b.items : []).slice(0, MAX_ITEMS)
          .map(function (it) { return clip(it, MAX_ITEM).trim(); })
          .filter(Boolean);
        if (!items.length) return '';
        return '<ul>' + items.map(function (it) { return '<li>' + inline(it) + '</li>'; }).join('') + '</ul>';
      }
      case 'image': {
        var src = String(b.src == null ? '' : b.src);
        /* 只接受站内上传目录。外链图片既不可控也不该进 CMS：
           运营贴一个外部 URL，半年后对方删图，文章就空了。 */
        if (src.indexOf('/uploads/') !== 0) return '';
        var alt = clip(b.alt, MAX_ALT);
        var cap = b.caption ? esc(clip(b.caption, 200)) : '';
        return '<figure class="prose__fig">' +
          '<img src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async">' +
          (cap ? '<figcaption>' + cap + '</figcaption>' : '') +
          '</figure>';
      }
      case 'hr':
        return '<hr>';
      default:
        return '';   // 未知类型静默丢弃
    }
  }

  function blocks(list) {
    if (!Array.isArray(list)) return '';
    return list.slice(0, MAX_BLOCKS).map(renderBlock).join('');
  }

  /* ---------------- 日期 ----------------
     固定英文月份缩写/全称表，不用 toLocaleDateString：
     服务端容器的 locale 与用户浏览器不一定相同，同一篇文章在两端会显示
     不同的月份名（甚至不同的日历），而 meta 里的日期又必须一致。 */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function dateParts(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }
  function longDate(iso) {
    var p = dateParts(iso);
    return p ? p.d + ' ' + MONTHS[p.m] + ' ' + p.y : '';
  }
  function isoDate(iso) {
    var p = dateParts(iso);
    if (!p) return '';
    return p.y + '-' + String(p.m + 1).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
  }

  var SECTION_LABEL = {
    materials: 'Materials',
    studio: 'Studio',
    giving: 'Giving',
    care: 'Care'
  };
  function sectionLabel(s) { return SECTION_LABEL[s] || (s ? String(s) : 'Journal'); }

  /* ---------------- 文章主体 ----------------
     注意 article 不含页头页脚：外层由 shell.js 提供，两端一致。 */
  function article(post, opts) {
    opts = opts || {};
    var p = post || {};
    var read = Number(p.readMinutes) || 1;
    var cover = p.coverImage ? String(p.coverImage) : '';

    var html = '<article class="post" data-slug="' + esc(p.slug) + '">' +
      '<div class="wrap post__head">' +
      '<div class="eyebrow">' + esc(sectionLabel(p.section)) + '</div>' +
      '<h1 class="post__title">' + esc(p.title) + '</h1>' +
      '<div class="post__meta">' + esc(longDate(p.publishedAt)) + ' · ' + read + ' min read</div>' +
      '</div>';

    if (cover) {
      html += '<figure class="post__cover">' +
        '<img src="' + esc(cover) + '" alt="' + esc(p.coverAlt || '') + '"' +
        ' fetchpriority="high" decoding="async">' +
        '</figure>';
    }

    html += '<div class="wrap"><div class="prose post__body">' +
      (p.excerpt ? '<p class="post__lede">' + esc(p.excerpt) + '</p>' : '') +
      blocks(p.blocks) +
      '</div></div>';

    if (p.cta && p.cta.label && p.cta.href && safeUrl(String(p.cta.href))) {
      html += '<div class="wrap post__cta">' +
        '<a class="btn" href="' + esc(p.cta.href) + '">' + esc(p.cta.label) + '</a>' +
        '</div>';
    }

    var prev = p.prev, next = p.next;
    if (prev || next) {
      html += '<nav class="wrap post__pager" aria-label="More articles">' +
        (prev
          ? '<a class="post__pager-l" href="/journal/' + esc(prev.slug) + '"><span>Previous</span>' + esc(prev.title) + '</a>'
          : '<span></span>') +
        (next
          ? '<a class="post__pager-r" href="/journal/' + esc(next.slug) + '"><span>Next</span>' + esc(next.title) + '</a>'
          : '<span></span>') +
        '</nav>';
    }

    return html + '</article>';
  }

  /* ---------------- 列表卡片 ----------------
     width/height 必带之外，无封面走 .jcard--ni（纯文字卡）：
     三篇旧文没有素材，硬留一个空图片框比没有框更难看。 */
  function card(post) {
    var p = post || {};
    var cover = p.coverImage ? String(p.coverImage) : '';
    var inner = cover
      ? '<div class="jcard__img"><img src="' + esc(cover) + '" alt="' + esc(p.coverAlt || '') +
        '" loading="lazy" decoding="async"></div>'
      : '';
    return '<a class="jcard' + (cover ? '' : ' jcard--ni') + '" href="/journal/' + esc(p.slug) + '">' +
      inner +
      '<div class="jcard__body">' +
      '<div class="eyebrow">' + esc(sectionLabel(p.section)) + '</div>' +
      '<h2 class="jcard__title">' + esc(p.title) + '</h2>' +
      '<p class="jcard__ex">' + esc(p.excerpt || '') + '</p>' +
      '<div class="jcard__date">' + esc(longDate(p.publishedAt)) + '</div>' +
      '</div></a>';
  }

  /* ---------------- meta ----------------
     title 加品牌后缀；总长超 60 时截标题而不是截后缀 ——
     「… — LASTGROVE」被截成「… — LASTGR」比标题少几个字更难看。 */
  var SUFFIX = ' — LASTGROVE';
  var MAX_TITLE = 60;
  var MAX_DESC = 158;

  function meta(post, origin, opts) {
    opts = opts || {};
    var p = post || {};
    var base = String(origin || '').replace(/\/+$/, '');

    var rawTitle = String(p.seoTitle || p.title || '').trim();
    var title = rawTitle + SUFFIX;
    if (title.length > MAX_TITLE) {
      var room = MAX_TITLE - SUFFIX.length;
      title = (rawTitle.length > room ? rawTitle.slice(0, Math.max(0, room - 1)).replace(/[\s,.]+$/, '') + '…' : rawTitle) + SUFFIX;
    }

    var description = clip(String(p.seoDescription || p.excerpt || '').trim(), MAX_DESC);
    var canonical = base + '/journal' + (p.slug ? '/' + p.slug : '');

    /* 无封面时用站点默认图：没有 og:image 的分享卡在多数平台是纯文字块，
       点击率明显低一档。 */
    var image = p.coverImage ? base + String(p.coverImage) : base + '/assets/img/opt/hero-necklaces.jpg';

    var og = {
      'og:type': opts.isList ? 'website' : 'article',
      'og:site_name': 'LASTGROVE',
      'og:title': rawTitle + SUFFIX,
      'og:description': description,
      'og:url': canonical,
      'og:image': image,
      'og:image:width': '1600',
      'og:image:height': '1200'
    };
    if (!opts.isList && p.publishedAt) og['article:published_time'] = String(p.publishedAt);

    var out = {
      title: title,
      description: description,
      canonical: canonical,
      robots: opts.noindex ? 'noindex,follow' : '',
      og: og,
      twitter: {
        'twitter:card': p.coverImage ? 'summary_large_image' : 'summary',
        'twitter:title': rawTitle + SUFFIX,
        'twitter:description': description,
        'twitter:image': image
      },
      jsonLd: null
    };

    if (!opts.isList) {
      out.jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: String(p.title || ''),
        description: description,
        image: [image],
        datePublished: String(p.publishedAt || ''),
        dateModified: String(p.updatedAt || p.publishedAt || ''),
        author: { '@type': 'Organization', name: 'LASTGROVE' },
        publisher: {
          '@type': 'Organization', name: 'LASTGROVE',
          logo: { '@type': 'ImageObject', url: base + '/assets/img/opt/hero-necklaces.jpg' }
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical }
      };
    } else {
      out.jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'Field Notes — LASTGROVE',
        url: canonical,
        publisher: { '@type': 'Organization', name: 'LASTGROVE' }
      };
    }

    return out;
  }

  /* ---------------- 阅读时长 ----------------
     按词算（200 词/分钟），连同 CJK 字符一起计：中文一个字约等于一个词的工作量，
     不然一篇中文文章会算出 0 分钟。写入时算一次存进 readMinutes，
     渲染时不再遍历全文。 */
  function countWords(list) {
    var s = '';
    (Array.isArray(list) ? list : []).forEach(function (b) {
      if (!b) return;
      s += ' ' + (b.text || '');
      if (Array.isArray(b.items)) s += ' ' + b.items.join(' ');
      if (b.caption) s += ' ' + b.caption;
    });
    var words = (s.match(/[A-Za-z0-9'’\-]+/g) || []).length;
    var cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
    return words + cjk;
  }
  function readMinutes(list) {
    var w = countWords(list);
    return Math.max(1, Math.round(w / 200));
  }

  return {
    esc: esc,
    inline: inline,
    blocks: blocks,
    article: article,
    card: card,
    meta: meta,
    longDate: longDate,
    isoDate: isoDate,
    sectionLabel: sectionLabel,
    countWords: countWords,
    readMinutes: readMinutes,
    safeUrl: safeUrl,
    limits: {
      MAX_BLOCKS: MAX_BLOCKS, MAX_TEXT: MAX_TEXT, MAX_ITEMS: MAX_ITEMS,
      MAX_ITEM: MAX_ITEM, MAX_ALT: MAX_ALT
    },
    BLOCK_TYPES: ['p', 'h2', 'h3', 'quote', 'ul', 'image', 'hr']
  };
}));
