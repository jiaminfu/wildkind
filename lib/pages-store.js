const { db, esc, money, getProduct, getCollection, productsIn, summary } = require('./core');
const { page, icon, productCard, starRow, breadcrumb } = require('./layout');

/* ============================ HOME ============================ */
function home(ctx = {}) {
  const d = db();
  const featured = d.products.filter((p) => p.featured).slice(0, 8);
  const bestsellers = featured.length >= 4 ? featured : d.products.slice(0, 8);
  const tiles = [
    { handle: 'ocean', title: 'Ocean', sub: 'Shells, turtles, tides', img: '/assets/img/c-ocean.png' },
    { handle: 'woodland', title: 'Woodland', sub: 'Foxes, ferns, hares', img: '/assets/img/c-woodland.png' },
    { handle: 'celestial', title: 'Moon & Stars', sub: 'Sun, moon, night sky', img: '/assets/img/c-celestial.png' },
    { handle: 'floral', title: 'Floral', sub: 'Clover, daisy, wildflower', img: '/assets/img/p-bracelet-clover-silver.png' },
  ];

  const body = `
  <section class="hero">
    <div class="hero__grid">
      <div class="hero__copy">
        <p class="eyebrow">${esc(d.content.hero.eyebrow)}</p>
        <h1>Nature,<br><em>worn close.</em></h1>
        <p>${esc(d.content.hero.body)}</p>
        <div class="hero__actions">
          <a class="btn" href="/collections/best-sellers">Shop best sellers</a>
          <a class="btn btn--ghost" href="/collections/new">See what is new</a>
        </div>
        <div class="hero__meta">
          <div><strong>316L</strong>surgical steel</div>
          <div><strong>PVD</strong>colour-locked finish</div>
          <div><strong>30 days</strong>no-questions returns</div>
        </div>
      </div>
      <div class="hero__media">
        <img src="${d.content.hero.image}" alt="Two layered gold necklaces worn at golden hour" width="1100" height="1375">
        <span class="hero__cap">${esc(d.content.hero.caption)}</span>
      </div>
    </div>
  </section>

  <section class="usp">
    <div class="wrap"><div class="usp__grid">
      ${d.content.usps.map((u, i) => `
        <div class="usp__item">
          ${icon(['truck', 'shield', 'refresh', 'leaf'][i] || 'check')}
          <h4>${esc(u.title)}</h4>
          <p>${esc(u.body)}</p>
        </div>`).join('')}
    </div></div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section__head">
        <div>
          <p class="eyebrow">As seen on TikTok</p>
          <h2>Best sellers</h2>
        </div>
        <a class="link-arrow" href="/collections/best-sellers">View all ${icon('arrow')}</a>
      </div>
      <div class="rail">
        ${bestsellers.map((p) => productCard(p)).join('')}
      </div>
    </div>
  </section>

  <section class="section section--bone">
    <div class="wrap">
      <div class="section__head">
        <div>
          <p class="eyebrow">Shop by nature</p>
          <h2>Four worlds, one drawer</h2>
        </div>
        <a class="link-arrow" href="/collections/gifts">All collections ${icon('arrow')}</a>
      </div>
      <div class="tiles">
        ${tiles.map((t) => `
          <a class="tile" href="/collections/${t.handle}">
            <img src="${t.img}" alt="${esc(t.title)}" loading="lazy" width="820" height="1025">
            <div class="tile__label"><span>${esc(t.sub)}</span><h3>${esc(t.title)}</h3></div>
          </a>`).join('')}
      </div>
    </div>
  </section>

  <section class="split">
    <div class="split__media">
      <img src="/assets/img/c-ocean.png" alt="Seashells and a gold chain on washed linen" loading="lazy" width="820" height="820">
    </div>
    <div class="split__copy">
      <p class="eyebrow">Built for water</p>
      <h2>Swim in it.<br>Sleep in it.<br>Forget it is there.</h2>
      <p>Salt water is the fastest way to ruin cheap plating. Ours is PVD over 316L steel — the same finish used on dive watch cases — so chlorine and sunscreen do not touch the colour.</p>
      <a class="btn btn--ghost" href="/pages/care">How we test it</a>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section__head">
        <div>
          <p class="eyebrow">Made for you</p>
          <h2>Your initials, our hands</h2>
        </div>
        <a class="link-arrow" href="/collections/custom">All custom ${icon('arrow')}</a>
      </div>
      <div class="grid grid--4">
        ${d.products.filter((p) => p.collections.includes('custom')).slice(0, 4).map((p) => productCard(p)).join('')}
      </div>
    </div>
  </section>

  <section class="wrap">
    <div class="quotes">
      ${d.content.testimonials.map((t) => `
        <div class="quote">
          <div class="quote__stars">${starRow(t.stars, 12)}</div>
          <p>“${esc(t.quote)}”</p>
          <div class="quote__who"><strong>${esc(t.name)}</strong><span>${esc(t.meta)}</span></div>
        </div>`).join('')}
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <div class="section__head">
        <div>
          <p class="eyebrow">Field notes</p>
          <h2>From the studio</h2>
        </div>
      </div>
      ${d.content.journal.map((j) => `
        <a class="jrow" href="/pages/journal">
          <div class="jrow__tag">${esc(j.tag)}</div>
          <div><h3>${esc(j.title)}</h3></div>
        </a>`).join('')}
    </div>
  </section>

  <section class="news">
    <div class="wrap wrap--narrow">
      <h2>Letters from the studio</h2>
      <p>New pieces, field notes, and 15% off your first order.</p>
      <form data-newsletter>
        <input type="email" placeholder="you@email.com" required aria-label="Email">
        <button type="submit" aria-label="Subscribe">${icon('arrow')}</button>
      </form>
    </div>
  </section>`;

  return page({
    title: 'Waterproof jewellery with a lifetime colour warranty',
    description: 'Nature-inspired stainless steel jewellery — animals, ocean and night skies. Waterproof, tarnish-free, made to be worn every day.',
    active: 'home', body, cartCount: ctx.cartCount,
  });
}

/* ========================== COLLECTION ========================== */
function collection(handle, query = {}, ctx = {}) {
  const c = getCollection(handle);
  if (!c) return null;
  let list = productsIn(handle);

  // 筛选
  const metal = query.metal || '';
  const price = query.price || '';
  const stock = query.stock || '';
  const sort = query.sort || 'featured';

  if (metal) list = list.filter((p) => p.metals.includes(metal));
  if (price === 'under60') list = list.filter((p) => p.price < 60);
  if (price === '60-80') list = list.filter((p) => p.price >= 60 && p.price <= 80);
  if (price === 'over80') list = list.filter((p) => p.price > 80);
  if (stock === 'in') list = list.filter((p) => p.stock > 0);

  if (sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
  else if (sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
  else if (sort === 'new') list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else if (sort === 'best') list = [...list].sort((a, b) => b.reviews - a.reviews);
  else list = [...list].sort((a, b) => (b.featured || 0) - (a.featured || 0));

  const qs = (patch) => {
    const q = { metal, price, stock, sort, ...patch };
    const parts = Object.entries(q).filter(([, v]) => v && v !== 'featured').map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };
  const chip = (label, active, href) =>
    `<a class="chip${active ? ' is-on' : ''}" href="${href}">${esc(label)}</a>`;

  const chips = [
    chip('All', !metal && !price && !stock, `/collections/${handle}${qs({ metal: '', price: '', stock: '' })}`),
    chip('Gold', metal === 'Gold', `/collections/${handle}${qs({ metal: 'Gold' })}`),
    chip('Silver', metal === 'Silver', `/collections/${handle}${qs({ metal: 'Silver' })}`),
    chip('Under $60', price === 'under60', `/collections/${handle}${qs({ price: 'under60' })}`),
    chip('$60–80', price === '60-80', `/collections/${handle}${qs({ price: '60-80' })}`),
    chip('In stock', stock === 'in', `/collections/${handle}${qs({ stock: 'in' })}`),
  ].join('');

  const sortOpts = [
    ['featured', 'Featured'], ['best', 'Best selling'], ['new', 'Newest'],
    ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'],
  ].map(([v, l]) => `<option value="${v}"${sort === v ? ' selected' : ''}>${l}</option>`).join('');

  const body = `
  <div class="wrap">
    ${breadcrumb([{ label: 'Home', href: '/' }, { label: c.title }])}
    <div class="coll-head">
      <h1>${esc(c.title)}</h1>
      ${c.intro ? `<p>${esc(c.intro)}</p>` : ''}
      <div class="coll-head__meta">${list.length} pieces</div>
    </div>

    <div class="toolbar">
      <div class="filters">${chips}</div>
      <div class="toolbar__right">
        <span class="count-note">${list.length} of ${productsIn(handle).length}</span>
        <div class="select-wrap">
          <form method="get" id="sortform">
            ${metal ? `<input type="hidden" name="metal" value="${esc(metal)}">` : ''}
            ${price ? `<input type="hidden" name="price" value="${esc(price)}">` : ''}
            ${stock ? `<input type="hidden" name="stock" value="${esc(stock)}">` : ''}
            <select name="sort" onchange="this.form.submit()" aria-label="Sort by">${sortOpts}</select>
            ${icon('chevron')}
          </form>
        </div>
      </div>
    </div>

    ${list.length
      ? `<div class="grid grid--4" style="padding-bottom:88px">${list.map((p) => productCard(p)).join('')}</div>`
      : `<div class="empty" style="margin-bottom:88px">No pieces match those filters. <a class="link-arrow" href="/collections/${handle}" style="margin-left:8px">Clear ${icon('arrow')}</a></div>`}
  </div>`;

  return page({
    title: c.title,
    description: c.intro || `${c.title} at Wildkind — waterproof stainless steel jewellery.`,
    active: handle, body, cartCount: ctx.cartCount,
  });
}

/* =========================== PRODUCT =========================== */
function product(handle, ctx = {}) {
  const p = getProduct(handle);
  if (!p) return null;
  const d = db();
  const onSale = p.compareAt && p.compareAt > p.price;
  const related = d.products
    .filter((x) => x.id !== p.id && x.collections.some((c) => p.collections.includes(c)))
    .slice(0, 4);
  const mainColl = p.collections.find((c) => ['necklaces', 'rings', 'bracelets', 'anklets', 'earrings', 'pearls', 'custom', 'gifts'].includes(c));
  const collObj = mainColl ? getCollection(mainColl) : null;

  const body = `
  <div class="pdp">
    <div class="pdp__media">
      <img src="${p.image}" alt="${esc(p.title)}" width="900" height="900">
      <img src="${p.imageAlt}" alt="${esc(p.title)} worn" width="900" height="900" loading="lazy">
    </div>
    <div class="pdp__info">
      ${breadcrumb([
        { label: 'Home', href: '/' },
        ...(collObj ? [{ label: collObj.title, href: `/collections/${collObj.handle}` }] : []),
        { label: p.title },
      ])}
      <h1 class="pdp__title">${esc(p.title)}</h1>
      <div class="pdp__rating">${starRow(p.rating, 12)}<span>${p.rating} · ${p.reviews} reviews</span></div>
      <div class="pdp__price">
        <span>${money(p.price)}</span>
        ${onSale ? `<s>${money(p.compareAt)}</s><em class="pdp__save">Save ${money(p.compareAt - p.price)}</em>` : ''}
      </div>
      <p class="pdp__desc">${esc(p.desc)}</p>

      <div class="opt">
        <div class="opt__head">
          <div class="opt__label">Metal <span>${esc(p.metals[0])}</span></div>
        </div>
        <div class="opts" data-opt="metal">
          ${p.metals.map((m, i) => `
            <button class="optbtn${i === 0 ? ' is-on' : ''}" data-value="${esc(m)}">
              <i class="swatch" data-metal="${esc(m)}"></i>${esc(m)}
            </button>`).join('')}
        </div>
      </div>

      ${p.sizes ? `
      <div class="opt">
        <div class="opt__head">
          <div class="opt__label">Size <span>${esc(p.sizes[0])}</span></div>
          <a class="opt__guide" href="/pages/faq">Size guide</a>
        </div>
        <div class="opts" data-opt="size">
          ${p.sizes.map((s, i) => `<button class="optbtn${i === 0 ? ' is-on' : ''}" data-value="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="pdp__buy">
        <div class="qty">
          <button data-qty="-1" aria-label="Decrease">${icon('minus')}</button>
          <span data-qty-val>1</span>
          <button data-qty="1" aria-label="Increase">${icon('plus')}</button>
        </div>
        <button class="btn" data-add data-id="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
          ${p.stock === 0 ? 'Sold out' : 'Add to bag'}
        </button>
      </div>
      ${p.stock > 0 && p.stock <= 18 ? `<p class="pdp__stock"><i class="dot"></i>Only ${p.stock} left — restocks take 3 weeks.</p>` : ''}

      <div class="pdp__trust">
        <div>${icon('truck')}<span><b>Free shipping over $75.</b> Ships from Portland in 1–2 days.</span></div>
        <div>${icon('shield')}<span><b>Lifetime colour warranty.</b> If it fades, we replace it.</span></div>
        <div>${icon('refresh')}<span><b>30-day returns.</b> Wear it first, decide later.</span></div>
      </div>

      <div class="acc" data-acc>
        <div class="acc__item is-open">
          <button class="acc__btn">Materials &amp; dimensions ${icon('plus')}</button>
          <div class="acc__panel">
            <dl>
              ${Object.entries(p.details).map(([k, v]) => `<dt>${esc(k.replace(/^\w/, (m) => m.toUpperCase()))}</dt><dd>${esc(v)}</dd>`).join('')}
            </dl>
          </div>
        </div>
        <div class="acc__item">
          <button class="acc__btn">Shipping ${icon('plus')}</button>
          <div class="acc__panel">United States: 3–5 business days, tracked, free over $75 ($6.90 under). Canada and UK: 5–8 business days. Everything ships from our Portland warehouse, so there is no customs bill at the door.</div>
        </div>
        <div class="acc__item">
          <button class="acc__btn">Care ${icon('plus')}</button>
          <div class="acc__panel">Rinse in fresh water after the sea, dry with a soft cloth. Avoid perfume directly on the metal. Do not use silver polish — it is not silver, and the abrasive will dull the PVD layer.</div>
        </div>
        <div class="acc__item">
          <button class="acc__btn">Warranty ${icon('plus')}</button>
          <div class="acc__panel">Colour is guaranteed for life. Send a photo to studio@wildkind.co and we ship a replacement free — no receipt, no original packaging, no questions.</div>
        </div>
      </div>
    </div>
  </div>

  <section class="section">
    <div class="wrap">
      <div class="section__head">
        <div><p class="eyebrow">Goes with</p><h2>You might also like</h2></div>
        <a class="link-arrow" href="/collections/best-sellers">All best sellers ${icon('arrow')}</a>
      </div>
      <div class="grid grid--4">${related.map((r) => productCard(r)).join('')}</div>
    </div>
  </section>`;

  return page({
    title: p.title,
    description: p.desc,
    active: 'product', body, cartCount: ctx.cartCount,
  });
}

/* =========================== SEARCH =========================== */
function search(q, ctx = {}) {
  const d = db();
  const term = (q || '').trim().toLowerCase();
  const list = term
    ? d.products.filter((p) =>
        [p.title, p.desc, p.motif, ...p.collections].join(' ').toLowerCase().includes(term))
    : [];

  const body = `
  <div class="wrap">
    <div class="coll-head" style="border-top:1px solid var(--line)">
      <p class="eyebrow">Search</p>
      <h1 style="margin-top:10px">${term ? `“${esc(q)}”` : 'What are you looking for?'}</h1>
      <div class="coll-head__meta">${list.length} result${list.length === 1 ? '' : 's'}</div>
    </div>
    ${list.length
      ? `<div class="grid grid--4" style="padding:34px 0 88px">${list.map((p) => productCard(p)).join('')}</div>`
      : `<div class="empty" style="margin:34px 0 88px">Nothing matched. Try “fox”, “turtle”, “pearl” or “stacking”.</div>`}
  </div>`;
  return page({ title: 'Search', description: 'Search Wildkind', active: 'search', body, cartCount: ctx.cartCount });
}

module.exports = { home, collection, product, search };
