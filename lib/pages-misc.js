const { db, esc, money, fmtDate, getProduct } = require('./core');
const { page, icon, productCard, breadcrumb } = require('./layout');

/* ============================ CART ============================ */
function cartPage(ctx = {}) {
  const cart = ctx.cart || [];
  const sub = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const ship = sub >= 75 || sub === 0 ? 0 : 6.9;
  const body = `
  <div class="wrap" style="padding-bottom:90px">
    <div class="coll-head" style="border-top:1px solid var(--line)">
      <h1>Your bag</h1>
      <div class="coll-head__meta">${cart.reduce((s, l) => s + l.qty, 0)} item${cart.reduce((s, l) => s + l.qty, 0) === 1 ? '' : 's'}</div>
    </div>
    ${cart.length ? `
      <div class="co" style="border:0">
        <div style="padding:38px 0;max-width:720px">
          ${cart.map((l) => `
            <div class="cline" style="grid-template-columns:96px 1fr">
              <img class="cline__img" style="width:96px;height:96px" src="${l.image}" alt="${esc(l.title)}">
              <div>
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <div>
                    <p class="cline__title"><a href="/products/${l.handle}">${esc(l.title)}</a></p>
                    <p class="cline__meta">${esc(l.metal)} · ${esc(l.size)}</p>
                  </div>
                  <p class="cline__price">${money(l.price * l.qty)}</p>
                </div>
                <div class="cline__row">
                  <div class="qty">
                    <button data-cart-qty="${l.productId}" data-qty="-1" aria-label="Decrease">${icon('minus')}</button>
                    <span>${l.qty}</span>
                    <button data-cart-qty="${l.productId}" data-qty="1" aria-label="Increase">${icon('plus')}</button>
                  </div>
                  <button class="link-arrow" data-cart-remove="${l.productId}" style="border:0;padding:0;font-size:10px">Remove</button>
                </div>
              </div>
            </div>`).join('')}
        </div>
        <div class="co__aside" style="border-left:1px solid var(--line);padding:38px 34px;align-self:start">
          <div class="totals">
            <div><span>Subtotal</span><span>${money(sub)}</span></div>
            <div><span>Shipping</span><span>${ship ? money(ship) : 'Free'}</span></div>
            <div class="is-total"><span>Total</span><span>${money(sub + ship)}</span></div>
          </div>
          <a class="btn btn--block" style="margin-top:22px" href="/checkout">Checkout</a>
          <p class="cart__note" style="margin-top:14px;text-align:center">Taxes calculated at checkout. Free returns for 30 days.</p>
        </div>
      </div>`
    : `<div class="empty" style="margin:44px 0">
        Your bag is empty. <a class="link-arrow" href="/collections/best-sellers" style="margin-left:10px">Start with best sellers ${icon('arrow')}</a>
      </div>`}
  </div>`;
  return page({ title: 'Your bag', description: 'Your Wildkind bag', body, cartCount: ctx.cartCount });
}

/* ========================== CHECKOUT ========================== */
function checkout(ctx = {}) {
  const cart = ctx.cart || [];
  const sub = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const ship = sub >= 75 || sub === 0 ? 0 : 6.9;
  const body = `
  <div class="co">
    <div class="co__main">
      <p class="co__step">Step 1 of 2</p>
      <h1>Checkout</h1>
      <form data-checkout>
        <h3 style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px">Contact</h3>
        <div class="field"><label>Email</label><input type="email" name="email" placeholder="you@email.com" required></div>
        <div class="field" style="display:flex;gap:9px;align-items:center;margin-bottom:26px">
          <input type="checkbox" id="news" style="width:15px;height:15px;accent-color:#111">
          <label for="news" style="margin:0;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--muted)">Email me new pieces (twice a month, no more)</label>
        </div>

        <h3 style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px">Shipping address</h3>
        <div class="field-row">
          <div class="field"><label>First name</label><input name="firstName" required></div>
          <div class="field"><label>Last name</label><input name="lastName" required></div>
        </div>
        <div class="field"><label>Address</label><input name="address" placeholder="Street and number" required></div>
        <div class="field"><label>Apartment, suite (optional)</label><input name="address2"></div>
        <div class="field-row">
          <div class="field"><label>City</label><input name="city" required></div>
          <div class="field"><label>State / Province</label><input name="state" required></div>
        </div>
        <div class="field-row">
          <div class="field"><label>ZIP / Postcode</label><input name="zip" required></div>
          <div class="field"><label>Country</label>
            <select name="country">
              <option>United States</option><option>Canada</option><option>United Kingdom</option>
            </select>
          </div>
        </div>

        <h3 style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:26px 0 14px">Payment</h3>
        <div class="paybox">
          <div class="paybox__row" style="justify-content:space-between">
            <span style="display:flex;align-items:center;gap:9px"><input type="radio" checked name="pay"> Card</span>
            <span style="font-size:10.5px;letter-spacing:.08em;color:var(--muted-2)">VISA · MC · AMEX</span>
          </div>
          <div style="margin-top:14px;display:grid;gap:10px">
            <div class="field" style="margin:0"><label>Card number</label><input placeholder="4242 4242 4242 4242" inputmode="numeric"></div>
            <div class="field-row">
              <div class="field" style="margin:0"><label>Expiry</label><input placeholder="MM / YY"></div>
              <div class="field" style="margin:0"><label>CVC</label><input placeholder="123" inputmode="numeric"></div>
            </div>
          </div>
        </div>
        <p style="font-size:11px;color:var(--muted-2);margin:12px 0 22px">Demo checkout — no card is charged. Orders are written to the admin panel.</p>
        <button class="btn btn--block" type="submit">Place order · ${money(sub + ship)}</button>
      </form>
    </div>
    <div class="co__aside">
      <div class="co__sum">
        ${cart.map((l) => `
          <div class="oline">
            <img src="${l.image}" alt="">
            <div>${esc(l.title)}<small>${esc(l.metal)} · ${esc(l.size)} · ×${l.qty}</small></div>
            <div>${money(l.price * l.qty)}</div>
          </div>`).join('') || '<p style="font-size:13px;color:var(--muted)">Your bag is empty.</p>'}
      </div>
      <div class="totals">
        <div><span>Subtotal</span><span>${money(sub)}</span></div>
        <div><span>Shipping</span><span>${ship ? money(ship) : 'Free'}</span></div>
        <div><span>Tax (est.)</span><span>—</span></div>
        <div class="is-total"><span>Total</span><span>${money(sub + ship)}</span></div>
      </div>
      <div style="margin-top:22px;display:grid;gap:10px;font-size:12px;color:var(--muted)">
        <div style="display:flex;gap:9px;align-items:center">${icon('shield')} Lifetime colour warranty</div>
        <div style="display:flex;gap:9px;align-items:center">${icon('refresh')} 30-day free returns</div>
        <div style="display:flex;gap:9px;align-items:center">${icon('truck')} Ships from Portland, OR</div>
      </div>
    </div>
  </div>`;
  return page({ title: 'Checkout', description: 'Secure checkout', body, cartCount: ctx.cartCount });
}

/* ======================= CONTENT PAGES ======================= */
function contentPage(kind, ctx = {}) {
  const d = db();
  const pages = {
    about: {
      title: 'Our story',
      eyebrow: 'Since 2024',
      intro: 'A small studio that makes one thing well: jewellery you never have to take off.',
      body: `
        <div class="prose wrap wrap--narrow">
          ${d.content.story.body.map((t) => `<p>${esc(t)}</p>`).join('')}
          <img src="/assets/img/c-woodland.png" alt="Fern fronds and a gold chain on paper" style="width:100%">
          <h2>What we will not do</h2>
          <p>We will not plate brass and call it gold. We will not sell a piece we have not swum in. And we will not run a sale every three weeks to make a full price look like a bargain.</p>
          <h2>Where the money goes</h2>
          <p>1% of every order funds a reef nursery in Hainan and a native woodland planting scheme in Oregon. In 2026 that was $14,200 — the receipts are in our field notes.</p>
        </div>`,
    },
    care: {
      title: 'Caring for your piece',
      eyebrow: 'Care',
      intro: '316L steel does not need much. Here is the whole routine.',
      body: `<div class="prose wrap wrap--narrow">
        <h2>The 30-second routine</h2>
        <p>Rinse in fresh water after the sea or the pool, dry with a soft cloth, put it back on. That is it. No polishing cloth required, no ultrasonic cleaner.</p>
        <h2>Three things to avoid</h2>
        <ul>
          <li>Silver polish — this is not silver, and the abrasive dulls the PVD layer.</li>
          <li>Perfume sprayed directly onto the metal, repeatedly, for years.</li>
          <li>Chlorine left to dry on the surface. Rinse it off and you are fine.</li>
        </ul>
        <h2>If the colour ever fades</h2>
        <p>Send a photo to studio@wildkind.co. We replace it free, for life, no receipt needed. That is the whole warranty.</p>
      </div>`,
    },
    shipping: {
      title: 'Shipping & returns',
      eyebrow: 'Help',
      intro: 'Everything ships from Portland, Oregon. No customs bill at your door.',
      body: `<div class="prose wrap wrap--narrow">
        <h2>Rates and timing</h2>
        <ul>
          <li><b>United States</b> — 3–5 business days, tracked. Free over $75, otherwise $6.90.</li>
          <li><b>Canada</b> — 5–8 business days, tracked. Free over $75, otherwise $9.50.</li>
          <li><b>United Kingdom</b> — 5–8 business days, tracked. $12 flat. VAT is included in the displayed price.</li>
        </ul>
        <h2>Customs</h2>
        <p>Because stock is already in the US, US orders never see an import charge. Canadian and UK orders are shipped DDP — the price you pay at checkout is the price at the door.</p>
        <h2>Returns</h2>
        <p>30 days, worn or unworn. Email us, we send a prepaid label, you get the money back within 3 days of us receiving it. Custom and personalised pieces are excluded unless faulty.</p>
        <h2>Exchanges</h2>
        <p>Wrong size? We send the replacement first, so you are not waiting twice.</p>
      </div>`,
    },
    faq: {
      title: 'Frequently asked',
      eyebrow: 'Help',
      intro: 'Short answers to the things people email us about most.',
      body: `<div class="wrap wrap--narrow prose" style="padding-top:44px">
        ${[
          ['Will it turn my skin green?', 'No. Green skin comes from copper or brass reacting with sweat. There is no copper in the base metal and the PVD layer is inert, so nothing leaches.'],
          ['Can I really shower and swim in it?', 'Yes — pool, sea, shower, gym. Rinse in fresh water afterwards and dry it. Thousands of customers wear the same piece for years without taking it off.'],
          ['Is it real gold?', 'It is 18k gold PVD over 316L stainless steel, not solid gold. That is why a $62 necklace exists. The colour is bonded at a molecular level and will not flake like plating.'],
          ['How long does a custom piece take?', 'Five to seven working days in the studio, then standard shipping. We email a photo before it ships.'],
          ['What if it fades?', 'We replace it. Free, for life, no receipt. Send a photo to studio@wildkind.co.'],
          ['Do you ship to the EU?', 'Not yet. EU GPSR requires an authorised representative and per-country packaging registration, which we are setting up for 2027.'],
          ['How do I find my ring size?', 'Wrap a strip of paper around the finger, mark it, measure in mm. Our size chart: 5 = 49 mm, 6 = 52 mm, 7 = 54 mm, 8 = 57 mm, 9 = 59 mm.'],
        ].map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
      </div>`,
    },
    privacy: {
      title: 'Privacy policy', eyebrow: 'Legal', intro: 'What we collect, why, and how to get rid of it.',
      body: `<div class="prose wrap wrap--narrow">
        <p>Last updated 1 November 2026. This is a demo site; the policy below describes how the real store operates.</p>
        <h2>What we collect</h2>
        <p>Order details (name, address, email), and anonymous analytics. We do not buy data, and we do not sell it.</p>
        <h2>Cookies</h2>
        <p>Two: a session cookie that holds your bag, and an analytics cookie. No advertising trackers are set before you consent.</p>
        <h2>Your rights</h2>
        <p>Under GDPR and CCPA you can ask for a copy of your data or its deletion. Email studio@wildkind.co and we respond within 30 days.</p>
      </div>`,
    },
    terms: {
      title: 'Terms of service', eyebrow: 'Legal', intro: 'The plain-language version.',
      body: `<div class="prose wrap wrap--narrow">
        <p>This is a demonstration site built as a prototype. Nothing here is a binding offer and no payment is taken.</p>
        <h2>Orders</h2>
        <p>In a live store, an order is accepted when it ships. Prices are in USD and include any applicable duties for DDP destinations.</p>
        <h2>Warranty</h2>
        <p>The lifetime colour warranty covers colour change, not physical damage or loss.</p>
      </div>`,
    },
    accessibility: {
      title: 'Accessibility', eyebrow: 'Legal', intro: 'Where we are, and what we are fixing.',
      body: `<div class="prose wrap wrap--narrow">
        <p>The store targets WCAG 2.2 AA. Body text is 15px with a 1.65 line height, all interactive elements are keyboard reachable, and colour is never the only signal.</p>
        <h2>Known gaps</h2>
        <ul><li>The image gallery on product pages does not yet support swipe gestures with a screen reader.</li>
        <li>Some older journal articles have insufficient contrast in their captions.</li></ul>
        <p>Found something? studio@wildkind.co — we fix accessibility bugs first.</p>
      </div>`,
    },
    journal: {
      title: 'Field notes', eyebrow: 'Journal', intro: 'Materials, workshops, and where the 1% goes.',
      body: `<div class="prose wrap wrap--narrow">
        ${db().content.journal.map((j) => `<h2>${esc(j.title)}</h2><p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted-2);margin-bottom:10px">${esc(j.tag)} · ${fmtDate(j.date)}</p><p>Full article coming with the production build. This prototype shows the layout and typographic rhythm of the journal template.</p>`).join('')}
      </div>`,
    },
  };
  const p = pages[kind];
  if (!p) return null;
  return page({
    title: p.title, description: p.intro, active: kind,
    body: `<div class="page-head"><div class="wrap wrap--narrow"><p class="eyebrow">${esc(p.eyebrow)}</p><h1 style="margin-top:14px">${esc(p.title)}</h1><p>${esc(p.intro)}</p></div></div>${p.body}`,
    cartCount: ctx.cartCount,
  });
}

/* ========================== ACCOUNT ========================== */
function account(query = {}, ctx = {}) {
  const d = db();
  let orders = [];
  let searched = false;
  const email = (query.email || '').trim().toLowerCase();
  const number = (query.number || '').trim().replace(/^#/, '').toUpperCase();
  if (email || number) {
    searched = true;
    orders = d.orders.filter((o) => {
      const okEmail = email && o.customer.email.toLowerCase() === email;
      const okNumber = number && o.number.replace('#', '').toUpperCase() === number;
      return email && number ? okEmail && okNumber : okEmail || okNumber;
    });
  }

  const body = `
  <div class="wrap">
    <div class="lookup">
      <h1>Find your order</h1>
      <p>Enter the order number from your confirmation email, or the email you used.</p>
      <form method="get" action="/account">
        <div class="field"><label>Order number</label><input name="number" placeholder="#WK1142" value="${esc(query.number || '')}"></div>
        <div class="field"><label>Email</label><input name="email" type="email" placeholder="you@email.com" value="${esc(query.email || '')}"></div>
        <button class="btn btn--block" type="submit" style="margin-top:8px">Look up</button>
      </form>
      ${searched ? (orders.length ? orders.map((o) => `
        <div class="order-card" style="margin-top:26px">
          <div class="order-card__head">
            <div><strong>${esc(o.number)}</strong><div style="font-size:11.5px;color:var(--muted);margin-top:3px">${fmtDate(o.createdAt)}</div></div>
            <span class="status status--${esc(o.status)}">${esc(o.status)}</span>
          </div>
          ${o.items.map((it) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>${esc(it.title)} <span style="color:var(--muted-2)">×${it.qty}</span></span><span>${money(it.price * it.qty)}</span></div>`).join('')}
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);margin-top:10px;padding-top:10px;font-size:14px"><span>Total</span><strong>${money(o.total)}</strong></div>
          ${o.tracking ? `<p style="font-size:11.5px;color:var(--muted);margin-top:10px">Tracking ${esc(o.tracking)} · arriving in 2–4 days</p>` : ''}
        </div>`).join('')
        : `<p style="margin-top:26px;font-size:13.5px;color:var(--muted)">No order matched. In the demo, try <b>#WK1142</b> with the email <b>emily.carter@gmail.com</b> — or open the admin panel to see all orders.</p>`)
        : ''}
      <p style="margin-top:30px;font-size:12px;color:var(--muted-2)">Need help? <a href="mailto:studio@wildkind.co" style="text-decoration:underline">studio@wildkind.co</a></p>
    </div>
  </div>`;
  return page({ title: 'Find your order', description: 'Order lookup', body, cartCount: ctx.cartCount });
}

/* ======================= ORDER CONFIRMATION ======================= */
function orderConfirmation(order, ctx = {}) {
  if (!order) return null;
  const body = `
  <div class="wrap">
    <div class="lookup" style="max-width:560px;text-align:center;padding-top:80px">
      <div style="width:52px;height:52px;border:1px solid var(--ink);border-radius:50%;display:grid;place-items:center;margin:0 auto 22px">
        ${icon('check')}
      </div>
      <h1 style="font-size:34px">Thank you.</h1>
      <p style="margin-top:10px">Order <b>${esc(order.number)}</b> is confirmed. A receipt is on its way to ${esc(order.customer.email)}.</p>
      <div style="text-align:left;margin-top:34px">
        ${order.items.map((it) => `
          <div class="oline">
            <img src="${(getProduct(it.productId) || {}).image || ''}" alt="">
            <div>${esc(it.title)}<small>${esc(it.variant)} · ${esc(it.size)} · ×${it.qty}</small></div>
            <div>${money(it.price * it.qty)}</div>
          </div>`).join('')}
      </div>
      <div class="totals" style="margin-top:18px;text-align:left">
        <div><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
        <div><span>Shipping</span><span>${order.shipping ? money(order.shipping) : 'Free'}</span></div>
        ${order.discount ? `<div><span>Discount</span><span>−${money(order.discount)}</span></div>` : ''}
        <div class="is-total"><span>Total</span><span>${money(order.total)}</span></div>
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:22px">Ships from Portland, OR within 1–2 business days. You will get a tracking number by email.</p>
      <a class="btn" style="margin-top:26px" href="/collections/best-sellers">Keep shopping</a>
      <p style="margin-top:16px;font-size:12px"><a href="/admin/orders" style="text-decoration:underline">View this order in the admin panel →</a></p>
    </div>
  </div>`;
  return page({ title: 'Order confirmed', description: 'Thank you', body, cartCount: 0 });
}

function notFound(ctx = {}) {
  const body = `
  <div class="wrap">
    <div class="lookup" style="text-align:center;padding:110px 0">
      <p class="eyebrow">404</p>
      <h1 style="font-size:46px;margin-top:12px">This path is overgrown.</h1>
      <p style="margin-top:12px">The page you were looking for does not exist — or it went back to the wild.</p>
      <a class="btn" style="margin-top:26px" href="/">Back to the shop</a>
    </div>
  </div>`;
  return page({ title: 'Not found', description: 'Page not found', body, cartCount: ctx.cartCount });
}

module.exports = { cartPage, checkout, contentPage, account, orderConfirmation, notFound };
