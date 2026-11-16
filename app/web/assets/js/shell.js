/* ============================================================
   LASTGROVE · 站点外壳（页头 / 页脚）
   ============================================================

   为什么这个文件必须存在（博客模块 SDS D-4）：
   /journal/x 是服务端预渲染的真路径页面，首屏 HTML 里就得有页头页脚。
   如果服务端自己拼一份、前端 ui.js 再拼一份，两份早晚会漂移 ——
   以及漂移之后是「服务端一版页头、JS 接管后又变一版」这种闪一下的 bug。

   所以这里做成 UMD：服务端 require、浏览器 <script> 挂 window.Shell，
   同一份代码两端跑。数据由调用方传进来（服务端从 db 取，前端从 S 取），
   HTML 模板只有这一份。

   链接一律写成 `/#/...`（前导斜杠），不是 `#/...`：
   当前页面是 /journal/x 时，裸 `#/collections/y` 会变成
   /journal/x#/collections/y —— 同文档 hash 变化，不重新加载，
   SPA 会渲染商品页但地址栏停在文章地址上，一刷新就退回文章。
   带上前导斜杠，pathname 变化触发整页导航，行为才正确。
   在 /#/xxx 这类 hash 页面里带斜杠也不会有副作用（同文档 hash 变化）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shell = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- 转义 ----------------
     与 core.js 的 U.esc 逐字符一致。不共享是因为 shell 要能被服务端
     require，而 core.js 依赖 localStorage / window，服务端加载不了。 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 响应式图片 ----------------
     与 core.js U.pic / U.picParts 同一套规则（两档宽度由 tools/opt-img2.js 决定）。
     两端必须一致，否则博客页的商品图和 hash 页的商品图分辨率不同。 */
  function picParts(src) {
    var s = String(src == null ? '' : src);
    try {
      if (typeof window !== 'undefined' && window.location && s.indexOf(window.location.origin) === 0) {
        s = s.slice(window.location.origin.length);
      }
    } catch (e) { /* 服务端没有 window，原样处理 */ }
    var m = /^(.*\/)?img\/opt\/([A-Za-z0-9_.-]+)\.(?:jpg|jpeg|png|webp)$/i.exec(s);
    if (!m) return null;
    var dir = (m[1] || '') + 'img/opt/';
    var base = m[2];
    var widths = /^hero-/.test(base) ? [700, 1100] : (/^c-/.test(base) ? [400, 820] : [440, 900]);
    return {
      dir: dir,
      base: base,
      widths: widths,
      set: widths.map(function (w) { return dir + base + '-' + w + '.webp ' + w + 'w'; }).join(', ')
    };
  }

  function pic(src, o) {
    o = o || {};
    var s = String(src == null ? '' : src);
    var alt = o.alt == null ? '' : o.alt;
    var cls = o.cls ? ' class="' + o.cls + '"' : '';
    var wh = (o.w && o.h) ? ' width="' + o.w + '" height="' + o.h + '"' : '';
    var load = o.priority ? ' fetchpriority="high"' : ' loading="lazy"';
    var extra = o.extra ? ' ' + o.extra : '';
    var p = picParts(s);
    if (!p) {
      return '<img src="' + esc(s) + '" alt="' + esc(alt) + '"' + wh + load +
        ' decoding="async"' + cls + extra + '>';
    }
    var sizes = o.sizes || '(max-width:640px) 46vw, (max-width:1024px) 31vw, 320px';
    return '<picture>' +
      '<source type="image/webp" srcset="' + p.set + '" sizes="' + sizes + '">' +
      '<img src="' + esc(s) + '" alt="' + esc(alt) + '"' + wh + load +
      ' decoding="async"' + cls + extra + '></picture>';
  }

  /* ---------------- 图标 ----------------
     只收 shell 自己用到的 8 个。ui.js 里那张 37 个的 ICON 表留在原处不动 ——
     shell 多带 29 个用不上的 path，等于每次服务端渲染多拼几 KB 字符串。 */
  var ICON = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    bag: '<path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.2A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>',
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".9" fill="currentColor"/>',
    pinterest: '<circle cx="12" cy="12" r="9"/><path d="M9.5 21l2.2-8"/><path d="M9 11c0-2.2 1.6-3.6 3.5-3.6 2 0 3.3 1.2 3.3 3.2 0 2.4-1.3 4.2-3 4.2-.9 0-1.6-.7-1.4-1.6"/>',
    tiktok: '<path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 4c.4 2.4 1.9 3.9 4.2 4.2"/>'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || '') + '</svg>';
  }

  /* ---------------- 支付品牌 ----------------
     只画真实开通的四个（PayPal 收银台内的 Visa / MC / Amex + PayPal 本人）。
     Apple Pay / Google Pay 本站没接，写上去属于虚假标识，收单审核会逐项核对。 */
  var PAY_MARKS = {
    visa: '<svg viewBox="0 0 46 30" role="img" aria-label="Visa"><rect width="46" height="30" rx="3" fill="#fff"/>' +
      '<text x="23" y="20.6" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="700" font-style="italic" fill="#1A1F71" letter-spacing=".2">VISA</text></svg>',
    mastercard: '<svg viewBox="0 0 46 30" role="img" aria-label="Mastercard"><rect width="46" height="30" rx="3" fill="#fff"/>' +
      '<circle cx="19" cy="15" r="7.6" fill="#EB001B"/><circle cx="27" cy="15" r="7.6" fill="#F79E1B" fill-opacity=".88"/></svg>',
    amex: '<svg viewBox="0 0 46 30" role="img" aria-label="American Express"><rect width="46" height="30" rx="3" fill="#006FCF"/>' +
      '<text x="23" y="19.8" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="10.5" font-weight="700" fill="#fff" letter-spacing=".7">AMEX</text></svg>',
    paypal: '<svg viewBox="0 0 46 30" role="img" aria-label="PayPal"><rect width="46" height="30" rx="3" fill="#fff"/>' +
      '<text x="23" y="20" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="11.6" font-weight="700" font-style="italic" letter-spacing="-.2">' +
      '<tspan fill="#003087">Pay</tspan><tspan fill="#009CDE">Pal</tspan></text></svg>'
  };
  function payMark(name) {
    return '<span class="paymark">' + (PAY_MARKS[name] || '') + '</span>';
  }

  /* 品牌 mark：几乎闭合的环（搭扣）+ 环内一棵小树（grove） */
  var MARK = '<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">' +
    '<path d="M 66.68 12.47 A 48 48 0 1 1 53.32 12.47" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M 60 103 V 64 M 60 82 L 48 68 M 60 82 L 72 68" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="60" cy="12.47" r="4.5" fill="currentColor" opacity=".6"/>' +
    '</svg>';

  /* 只影响排序，不影响是否显示 */
  var NAV_ORDER = ['best-sellers', 'custom', 'sale', 'new', 'necklaces', 'rings', 'pearls', 'earrings', 'bracelets', 'anklets', 'gifts'];
  var MEGA = { necklaces: 1, rings: 1, pearls: 1, earrings: 1, bracelets: 1, anklets: 1 };
  var MOTIFS = ['ocean', 'woodland', 'celestial', 'floral'];
  var GIFT_SETS = ['for-her', 'for-him', 'gifts-for-mom', 'birthday-gifts', 'gift-sets'];

  /* ---------------- 数据默认值 ----------------
     服务端与前端都可能只传一部分，缺什么补什么，而不是让 undefined 冒到 HTML 里。 */
  function norm(data) {
    data = data || {};
    var colls = Array.isArray(data.collections) ? data.collections : [];
    var nav = Array.isArray(data.nav) ? data.nav : [];
    /* 一个集合都没有时（新站、刚清库），顶栏会只剩 LOGO 和三个图标，
       用户连「从哪开始逛」都找不到。给一个永远可用的兜底入口。 */
    if (!nav.length) nav = [{ handle: 'all', title: 'Shop all' }];
    nav = nav.slice().sort(function (a, b) {
      var ia = NAV_ORDER.indexOf(a.handle), ib = NAV_ORDER.indexOf(b.handle);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib;
    });
    return {
      collections: colls,
      nav: nav,
      announce: data.announce == null ? 'Free shipping over $95' : String(data.announce),
      socials: (data.socials && typeof data.socials === 'object') ? data.socials : {},
      user: data.user || null,
      cartCount: Number(data.cartCount) || 0,
      wishCount: Number(data.wishCount) || 0,
      route: data.route || {},
      /* 预渲染时为 true：此时没有任何交互状态，也不该出现「3 items in bag」这类瞬时文案 */
      isStatic: !!data.isStatic
    };
  }

  function hasColl(d, h) {
    return d.collections.some(function (c) { return c.handle === h; });
  }
  function collTitle(d, h) {
    var c = d.collections.filter(function (x) { return x.handle === h; })[0];
    return c ? c.title : h.replace(/-/g, ' ');
  }

  /* 公告文案来自后台 Content 页。分隔符同时接受 · 和 |：
     后台输入框里竖线更好打，历史数据里是圆点。 */
  function announcement(text) {
    return String(text).split(/[·|]/).map(function (t) {
      t = t.trim();
      return t ? '<span>' + esc(t) + '</span>' : '';
    }).join('<span>·</span>') + '<span>·</span>';
  }

  /* 品类项带 mega menu（FR-S-002）。
     面板内容一律从「库里真实存在的集合」长出来 —— 早先按参考站抄的硬编码清单
     里有 50 条链接条条 404，导航是主路径，点进去就是 Page not found。 */
  function megaPanel(d, handle, right) {
    var kids = d.collections.filter(function (c) { return c.parent === handle; });
    var motifs = MOTIFS.filter(function (m) { return hasColl(d, m); });
    var gifts = GIFT_SETS.filter(function (h) { return hasColl(d, h); });

    var col1 = kids.length
      ? kids.map(function (c) {
        return '<a href="/#/collections/' + c.handle + '">' + esc(c.title) + '</a>';
      }).join('')
      : '<a href="/#/collections/' + handle + '">All ' + esc(collTitle(d, handle)) + '</a>' +
        '<a href="/#/search?q=' + encodeURIComponent(collTitle(d, handle)) + '">Search ' + esc(collTitle(d, handle).toLowerCase()) + '</a>';

    /* 空列不渲染 —— 三列里两列空着比一个干净的短菜单更难看 */
    var cols = '<div class="mega__col"><h6>Shop by style</h6>' + col1 + '</div>';
    if (motifs.length) {
      cols += '<div class="mega__col"><h6>Shop by motif</h6>' +
        motifs.map(function (m) {
          return '<a href="/#/collections/' + m + '">' + esc(collTitle(d, m)) + '</a>';
        }).join('') + '</div>';
    }
    if (gifts.length) {
      cols += '<div class="mega__col"><h6>Gifts</h6>' +
        gifts.map(function (h) {
          return '<a href="/#/collections/' + h + '">' + esc(collTitle(d, h)) + '</a>';
        }).join('') + '</div>';
    }
    cols += '<div class="mega__col"><h6>More</h6>' +
      '<a href="/#/collections/' + handle + '">Shop all</a>' +
      '<a href="/#/search?q=' + encodeURIComponent(collTitle(d, handle)) + '">Search</a>' +
      (hasColl(d, 'sale') ? '<a href="/#/collections/sale">Sale</a>' : '') +
      '</div>';

    return '<div class="mega' + (right ? ' mega--right' : '') + '">' + cols +
      '<a class="mega__feat" href="/#/collections/' + handle + '">' +
      pic('assets/img/opt/hero-necklaces.jpg', { alt: '', w: 1100, h: 1375, sizes: '(max-width:900px) 90vw, 420px' }) +
      '<span>Shop all ' + esc(collTitle(d, handle)) + '</span></a>' +
      '</div>';
  }

  /* 桌面顶栏的横向空间是硬约束：1220–1600px 这几个断点本来就在临界点上
     （实测 1280px 时导航已经占满），再加一项直接溢出。
     Custom orders 是低频咨询入口，页脚 About 组里有、移动端抽屉里也有，
     所以让它在桌面顶栏不显示，位置留给 Journal。
     要恢复它：把这里改成空对象，同时接受顶栏在 1280px 换行或溢出。 */
  var NAV_SKIP_ON_DESKTOP = { custom: 1 };

  /* ---------------- 页头 ---------------- */
  function header(data) {
    var d = norm(data);
    var seg = (d.route && d.route.seg) || [];
    var cur = seg[0] === 'collections' ? (seg[1] || '') : '';

    var nav = d.nav.filter(function (c) { return !NAV_SKIP_ON_DESKTOP[c.handle]; })
      .map(function (c, i) {
      var k = [];
      if (c.handle === 'sale') k.push('hot');
      if (c.handle === cur) k.push('is-active');
      var cls = k.length ? ' class="' + k.join(' ') + '"' : '';
      var label = c.handle === 'new' ? 'New in' : c.title;
      var link = '<a href="/#/collections/' + c.handle + '"' + cls +
        (c.handle === cur ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>';
      if (!MEGA[c.handle]) return link;
      return '<div class="navitem">' + link + megaPanel(d, c.handle, i >= 7) + '</div>';
    }).join('');

    var acctLabel = d.user
      ? 'Account — hello, ' + esc(d.user.first)
      : 'Sign in or create an account';

    /* Journal 不是集合，长不出 mega panel，所以是写死的最后一项。
       没有这个入口，博客上线等于没人找得到（FR-B-028）。 */
    var journalOn = seg[0] === 'journal';
    var journalLink = '<a href="/journal"' +
      (journalOn ? ' class="is-active" aria-current="page"' : '') + '>Journal</a>';

    return '' +
      '<div class="annbar"><div class="annbar__track">' +
      announcement(d.announce) +
      announcement(d.announce) +
      '</div></div>' +
      '<header class="hdr" id="hdr"><div class="wrap"><div class="hdr__inner">' +
      '<button class="mob-menu-btn" data-act="open-menu" aria-label="Menu">' + icon('menu') + '</button>' +
      '<nav class="hdr__nav">' + nav + journalLink + '</nav>' +
      '<a href="/#" class="brand" aria-label="LASTGROVE home"><span class="brand__mark" aria-hidden="true">' + MARK + '</span><span class="brand__word">LASTGROVE</span></a>' +
      '<div class="hdr__tools">' +
      '<button class="icon-btn" data-act="open-search" aria-label="Search">' + icon('search') + '</button>' +
      /* 账号入口只留图标，和搜索/收藏/购物袋保持同一套语言。
         早先是「文字 Sign in（桌面）+ 人形图标（手机）」两套并存，
         同一个入口在断点两侧长得不一样，视觉上很突兀。 */
      '<a class="icon-btn hdr__acct" href="/#/account" id="acctBtn" aria-label="' + acctLabel + '">' + icon('user') + '</a>' +
      '<a class="icon-btn hdr__wish" href="/#/account/wishlist" id="wishBtn"' +
      ' aria-label="Wishlist' + (d.wishCount ? ', ' + d.wishCount + ' saved' : '') + '">' +
      icon('heart') +
      '<span class="bag-count' + (d.wishCount ? '' : ' is-zero') + '" id="wishCount">' + d.wishCount + '</span></a>' +
      '<button class="icon-btn" data-act="open-cart" aria-label="Bag">' + icon('bag') +
      '<span class="bag-count' + (d.cartCount ? '' : ' is-zero') + '" id="bagCount">' + d.cartCount + '</span></button>' +
      '</div></div></div></header>';
  }

  /* ---------------- 页脚 ---------------- */

  /* 社交图标只在店主真的填了账号之后才出现。
     原来是三个图标全部指向「关于我们」—— 点得开，但不是它说的那件事。
     假链接比没有更伤信任：访客点一次 Instagram、落到一段品牌故事上，
     他会顺手把「这个站不太靠谱」这条结论也一起记住。 */
  var SOCIAL_KEYS = [['instagram', 'Instagram'], ['pinterest', 'Pinterest'], ['tiktok', 'TikTok']];
  function socialRow(d) {
    var s = (d && d.socials) || {};
    var out = SOCIAL_KEYS.filter(function (x) {
      /* 只认绝对 http(s)。库里已经归一化过一次，这里再挡一次是因为
         这段输出也会用在服务端预渲染的 /journal 页上，而那条路径不经过 bootstrap。 */
      return typeof s[x[0]] === 'string' && /^https?:\/\//i.test(s[x[0]]);
    }).map(function (x) {
      return '<a href="' + esc(s[x[0]]) + '" aria-label="' + x[1] + '" rel="noopener noreferrer" target="_blank">' +
        icon(x[0]) + '</a>';
    });
    if (!out.length) return '';
    return '<div style="display:flex;gap:14px;margin-top:18px">' + out.join('') + '</div>';
  }

  function footer(data) {
    var d = norm(data);
    /* Shop 列表只列真实存在的集合。写死的六个在清库后全是 404，
       而且这类死链藏在页脚里，平时没人点，上线后才发现。 */
    var shopWant = ['best-sellers', 'new', 'necklaces', 'rings', 'bracelets', 'anklets', 'earrings', 'sale'];
    var shopHave = shopWant.filter(function (h) { return hasColl(d, h); });
    var shopLinks = shopHave.length
      ? shopHave.map(function (h) {
        return '<li><a href="/#/collections/' + h + '">' + esc(collTitle(d, h)) + '</a></li>';
      }).join('')
      : '<li><a href="/#/collections/all">Shop all</a></li>';

    return '<footer class="ftr"><div class="wrap">' +
      '<div class="ftr__top">' +
      '<div class="ftr__brand"><a href="/#" class="brand" aria-label="LASTGROVE home"><span class="brand__mark" aria-hidden="true">' + MARK + '</span><span class="brand__word">LASTGROVE</span></a>' +
      '<p>316L stainless steel, made in short runs. Silver pieces are unplated; gold is 18k PVD over steel.</p>' +
      socialRow(d) + '</div>' +
      '<div><h5>Shop</h5><ul>' + shopLinks + '</ul></div>' +
      '<div><h5>Help</h5><ul>' +
      '<li><a href="/#/pages/shipping">Shipping &amp; Duties</a></li>' +
      '<li><a href="/#/pages/returns">Returns</a></li>' +
      '<li><a href="/#/pages/care">Care Guide</a></li>' +
      '<li><a href="/#/pages/size-guide">Size Guide</a></li>' +
      '<li><a href="/#/account/lookup">Track My Order</a></li>' +
      '<li><a href="/#/pages/faq">FAQ</a></li></ul></div>' +
      '<div><h5>About</h5><ul>' +
      '<li><a href="/#/pages/about">Our Story</a></li>' +
      '<li><a href="/#/pages/materials">Materials</a></li>' +
      '<li><a href="/#/custom">Custom orders</a></li>' +
      /* Field Notes 走真路径：这是全站唯一一个真路径页面 */
      '<li><a href="/journal">Field Notes</a></li>' +
      '<li><a href="/#/pages/contact">Contact</a></li></ul></div>' +
      '</div>' +
      '<div class="ftr__bot"><span>© 2026 LASTGROVE. All rights reserved.</span>' +
      /* 支付标识必须和真实开通的通道一致 */
      '<div class="ftr__pay">' + payMark('visa') + payMark('mastercard') + payMark('amex') + payMark('paypal') + '</div>' +
      /* 底栏三个法务页原来是纯文本 <span>，点不进去。收单审核必须能一键打开隐私政策 */
      '<div class="ftr__legal">' +
      '<a href="/#/pages/privacy">Privacy Policy</a>' +
      '<a href="/#/pages/terms">Terms of Service</a>' +
      '<a href="/#/pages/shipping">Shipping Policy</a>' +
      '<a href="/#/pages/returns">Returns Policy</a>' +
      '<a href="/#/pages/accessibility">Accessibility</a>' +
      '</div></div>' +
      '</div></footer>';
  }

  return {
    header: header,
    footer: footer,
    /* 服务端用：一次拿到整页外壳，避免调用方自己拼顺序 */
    wrap: function (body, data) { return header(data) + body + footer(data); },
    esc: esc,
    icon: icon,
    pic: pic,
    mark: MARK
  };
}));
