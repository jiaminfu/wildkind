const { db, esc, navCollections, menuFor, money } = require('./core');

const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.2 3.4-7 7.5-7s7.5 2.8 7.5 7"/>',
  bag: '<path d="M6 7h12l1.2 13.2a1 1 0 0 1-1 1.1H5.8a1 1 0 0 1-1-1.1L6 7Z"/><path d="M9 7V5.6A3 3 0 0 1 12 3a3 3 0 0 1 3 2.6V7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18.5" r="1.6"/><circle cx="17.5" cy="18.5" r="1.6"/>',
  shield: '<path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  leaf: '<path d="M20 4C11 4 5 8.5 5 15a6 6 0 0 0 6 6c6.5 0 9-6 9-17Z"/><path d="M9 19c2-5 5-8 9-10"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.6L21 9"/><path d="M21 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L3 15"/><path d="M3 20v-5h5"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8Z"/>',
  filter: '<path d="M3 6h18M6 12h12M10 18h4"/>',
  menu: '<path d="M3 7h18M3 12h18M3 17h18"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor"/>',
  pinterest: '<circle cx="12" cy="12" r="9"/><path d="M9.5 20c1-2 1.6-4.2 2-6"/><path d="M10.5 13.5c-.6-2.4 1-4.5 3.2-4.5 1.8 0 2.8 1.2 2.8 2.9 0 2-1.2 3.6-2.9 3.6-1 0-1.7-.6-1.6-1.4"/>',
  tiktok: '<path d="M14 4v9.6a3.4 3.4 0 1 1-3.4-3.4"/><path d="M14 6.4A4.6 4.6 0 0 0 18.6 11"/>',
};

function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;
}

function header(active, cartCount) {
  const nav = navCollections();
  const items = nav.map((c) => {
    const groups = menuFor(c.handle);
    const hasMenu = groups.length > 0;
    const label = c.handle === 'new' ? `<em class="dot">•</em> ${esc(c.title)}` : esc(c.title);
    const cls = c.handle === 'sale' ? ' class="is-sale"' : '';
    if (!hasMenu) {
      return `<li><a href="/collections/${c.handle}"${cls}>${label}</a></li>`;
    }
    const cols = groups.map((g) => `
      <div class="mega__col">
        <p class="mega__title">${esc(g.title)}</p>
        <ul>${g.items.map((k) => `<li><a href="/collections/${k.handle}">${esc(k.title)}</a></li>`).join('')}</ul>
      </div>`).join('');
    return `<li class="has-mega"><a href="/collections/${c.handle}"${cls}>${label}</a>
      <div class="mega"><div class="mega__inner">${cols}</div></div></li>`;
  }).join('');

  const announce = db().content.announcement;
  return `
  <div class="announce">
    <div class="announce__track">
      ${announce.map((a) => `<span>${esc(a)}</span>`).join('<span class="announce__sep">·</span>')}
    </div>
  </div>
  <header class="hdr">
    <div class="hdr__inner">
      <nav class="hdr__nav" aria-label="Main">
        <button class="hdr__burger" aria-label="Menu" data-drawer-open>${icon('menu')}</button>
        <ul class="hdr__list">${items}</ul>
      </nav>
      <a class="brand" href="/" aria-label="Wildkind home">
        <span class="brand__word">Wildkind</span>
        <span class="brand__sub">nature, worn close</span>
      </a>
      <div class="hdr__tools">
        <button class="tool" data-search-open aria-label="Search">${icon('search')}</button>
        <a class="tool" href="/account" aria-label="Account">${icon('user')}</a>
        <button class="tool tool--bag" data-cart-open aria-label="Cart">
          ${icon('bag')}<span class="tool__count" data-cart-count>${cartCount || 0}</span>
        </button>
      </div>
    </div>
  </header>
  <div class="mobile-drawer" data-drawer hidden>
    <div class="mobile-drawer__head">
      <span class="brand__word">Wildkind</span>
      <button class="tool" data-drawer-close aria-label="Close">${icon('close')}</button>
    </div>
    <ul class="mobile-drawer__list">
      ${nav.map((c) => `<li><a href="/collections/${c.handle}">${esc(c.title)}</a></li>`).join('')}
    </ul>
    <div class="mobile-drawer__foot">
      <a href="/pages/about">Our story</a><a href="/pages/faq">Help</a><a href="/account">Orders</a>
    </div>
  </div>
  <div class="search-panel" data-search-panel hidden>
    <form class="search-panel__form" action="/search" method="get">
      ${icon('search')}
      <input name="q" placeholder="Search animals, ocean, moon…" autocomplete="off" data-search-input>
      <button type="button" class="tool" data-search-close aria-label="Close">${icon('close')}</button>
    </form>
    <div class="search-panel__hint">Try “fox”, “turtle”, “stacking rings” or “gift”.</div>
  </div>`;
}

function footer() {
  const d = db();
  return `
  <footer class="ftr">
    <div class="ftr__top">
      <div class="ftr__brand">
        <span class="brand__word">Wildkind</span>
        <p>Small animals and quiet landscapes, cast in steel. Designed in Shenzhen, shipped from Portland.</p>
        <div class="ftr__social">
          <a href="#" aria-label="Instagram">${icon('instagram')}</a>
          <a href="#" aria-label="TikTok">${icon('tiktok')}</a>
          <a href="#" aria-label="Pinterest">${icon('pinterest')}</a>
        </div>
      </div>
      <div class="ftr__col">
        <p class="ftr__title">Shop</p>
        <ul>
          <li><a href="/collections/best-sellers">Best Sellers</a></li>
          <li><a href="/collections/new">New in</a></li>
          <li><a href="/collections/custom">Custom</a></li>
          <li><a href="/collections/gifts">Gifts</a></li>
          <li><a href="/collections/sale">Sale</a></li>
        </ul>
      </div>
      <div class="ftr__col">
        <p class="ftr__title">Help</p>
        <ul>
          <li><a href="/pages/shipping">Shipping &amp; returns</a></li>
          <li><a href="/pages/faq">FAQ</a></li>
          <li><a href="/pages/care">Caring for your piece</a></li>
          <li><a href="/account">Track an order</a></li>
          <li><a href="mailto:studio@wildkind.co">studio@wildkind.co</a></li>
        </ul>
      </div>
      <div class="ftr__col ftr__col--wide">
        <p class="ftr__title">Letters from the studio</p>
        <p class="ftr__note">New pieces, field notes, and the occasional 15% off. No more than twice a month.</p>
        <form class="ftr__form" data-newsletter>
          <input type="email" placeholder="you@email.com" required>
          <button type="submit">${icon('arrow')}</button>
        </form>
        <p class="ftr__micro">By subscribing you agree to our <a href="/pages/privacy">privacy policy</a>.</p>
      </div>
    </div>
    <div class="ftr__bottom">
      <p>© 2026 ${esc(d.settings.brandName)} Studio. All rights reserved.</p>
      <div class="ftr__legal">
        <a href="/pages/privacy">Privacy</a>
        <a href="/pages/terms">Terms</a>
        <a href="/pages/accessibility">Accessibility</a>
      </div>
      <div class="ftr__pay">Visa · Mastercard · Amex · Apple&nbsp;Pay · PayPal</div>
    </div>
  </footer>
  <aside class="cart" data-cart hidden aria-label="Shopping bag">
    <div class="cart__head">
      <p>Your bag <span data-cart-line></span></p>
      <button class="tool" data-cart-close aria-label="Close">${icon('close')}</button>
    </div>
    <div class="cart__body" data-cart-body></div>
    <div class="cart__foot" data-cart-foot></div>
  </aside>
  <div class="scrim" data-scrim hidden></div>`;
}

function page({ title, description, active = '', body, bodyClass = '', cartCount = 0 }) {
  const d = db();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(d.settings.brandName)}</title>
<meta name="description" content="${esc(description || d.settings.tagline)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Figtree:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/store.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26' font-family='Georgia'>W</text></svg>">
</head>
<body class="${bodyClass}" data-active="${active}">
${header(active, cartCount)}
<main id="main">${body}</main>
${footer()}
<script src="/assets/js/store.js" defer></script>
</body>
</html>`;
}

// ---------- 通用组件 ----------
function starRow(rating, size = 13) {
  const full = Math.round(rating);
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += `<svg class="star ${i < full ? 'is-on' : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.8-5.4 2.8 1-6.1L3.2 9.7l6.1-.9z"/></svg>`;
  }
  return `<span class="stars">${s}</span>`;
}

function productCard(p, opts = {}) {
  const onSale = p.compareAt && p.compareAt > p.price;
  const badge = p.badge
    ? `<span class="card__badge ${/low/i.test(p.badge) ? 'is-low' : /custom/i.test(p.badge) ? 'is-custom' : ''}">${esc(p.badge)}</span>`
    : p.stock <= 15 ? '<span class="card__badge is-low">Low stock</span>' : '';
  const dots = p.metals.slice(0, 3).map((m) =>
    `<i class="dot-metal" data-metal="${esc(m)}" title="${esc(m)}"></i>`).join('');
  return `
  <article class="card${opts.small ? ' card--sm' : ''}">
    <a class="card__media" href="/products/${p.handle}">
      ${badge}
      <img class="card__img" src="${p.image}" alt="${esc(p.title)}" loading="lazy" width="900" height="900">
      <img class="card__img card__img--alt" src="${p.imageAlt}" alt="" loading="lazy" aria-hidden="true" width="900" height="900">
    </a>
    <div class="card__info">
      <h3 class="card__title"><a href="/products/${p.handle}">${esc(p.title)}</a></h3>
      <p class="card__price">
        ${onSale ? `<span class="price">${money(p.price)}</span><s class="price--was">${money(p.compareAt)}</s><em class="price--save">Save ${money(p.compareAt - p.price)}</em>` : `<span class="price">${money(p.price)}</span>`}
      </p>
      <div class="card__swatches">${dots}</div>
    </div>
  </article>`;
}

function breadcrumb(trail) {
  return `<nav class="crumb" aria-label="Breadcrumb">${trail.map((t, i) =>
    i === trail.length - 1 ? `<span>${esc(t.label)}</span>` : `<a href="${t.href}">${esc(t.label)}</a><em>/</em>`
  ).join('')}</nav>`;
}

module.exports = { page, header, footer, icon, productCard, starRow, breadcrumb };
