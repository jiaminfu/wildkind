/* ============================================================
   Wildkind — storefront behaviour
   ============================================================ */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
  });

  const FREE_SHIP = 75;
  let cart = [];

  /* ---------------- cart state ---------------- */
  async function loadCart() {
    try {
      const r = await fetch('/api/cart');
      const j = await r.json();
      cart = j.cart || [];
      paintCount(j.count || 0);
      paintCart();
    } catch {}
  }

  function paintCount(n) {
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.style.display = n > 0 ? 'grid' : 'none';
    });
  }

  function paintCart() {
    const body = $('[data-cart-body]');
    const foot = $('[data-cart-foot]');
    const line = $('[data-cart-line]');
    if (!body) return;
    const sub = cart.reduce((s, l) => s + l.price * l.qty, 0);
    const units = cart.reduce((s, l) => s + l.qty, 0);
    if (line) line.textContent = units ? `(${units})` : '';

    if (!cart.length) {
      body.innerHTML = `<div class="cart__empty">
        <p>Your bag is empty.</p>
        <a class="btn btn--sm" href="/collections/best-sellers">Shop best sellers</a>
      </div>`;
      foot.innerHTML = '';
      return;
    }

    body.innerHTML = cart.map((l) => `
      <div class="cline">
        <a href="/products/${l.handle}"><img class="cline__img" src="${l.image}" alt="${esc(l.title)}"></a>
        <div>
          <p class="cline__title"><a href="/products/${l.handle}">${esc(l.title)}</a></p>
          <p class="cline__meta">${esc(l.metal)} · ${esc(l.size)}</p>
          <div class="cline__row">
            <div class="qty">
              <button data-cq="${l.productId}" data-d="-1" aria-label="Decrease">−</button>
              <span>${l.qty}</span>
              <button data-cq="${l.productId}" data-d="1" aria-label="Increase">+</button>
            </div>
            <span class="cline__price">${money(l.price * l.qty)}</span>
          </div>
        </div>
      </div>`).join('');

    const remain = Math.max(0, FREE_SHIP - sub);
    foot.innerHTML = `
      <p class="cart__ship">${remain > 0
        ? `You are <b>${money(remain)}</b> from free shipping`
        : `Free shipping unlocked — nice.`}</p>
      <div class="shipbar"><i style="width:${Math.min(100, (sub / FREE_SHIP) * 100)}%"></i></div>
      <div class="cart__sum" style="margin-top:16px"><span>Subtotal</span><strong>${money(sub)}</strong></div>
      <p class="cart__note">Shipping and tax calculated at checkout.</p>
      <a class="btn btn--block" href="/checkout">Checkout · ${money(sub)}</a>
      <a class="btn btn--ghost btn--block" href="/cart" style="margin-top:8px">View bag</a>`;
  }

  async function addToCart(productId, metal, size, qty = 1) {
    const r = await fetch('/api/cart/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, metal, size, qty }),
    });
    const j = await r.json();
    cart = j.cart || [];
    paintCount(j.count || 0);
    paintCart();
    openCart();
  }

  async function changeQty(productId, delta) {
    const r = await fetch('/api/cart/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, delta }),
    });
    const j = await r.json();
    cart = j.cart || [];
    paintCount(j.count || 0);
    paintCart();
  }

  async function removeLine(productId) {
    const r = await fetch('/api/cart/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    const j = await r.json();
    cart = j.cart || [];
    paintCount(j.count || 0);
    paintCart();
  }

  /* ---------------- overlays ---------------- */
  const scrim = $('[data-scrim]');
  function showScrim() { if (scrim) scrim.hidden = false; }
  function hideScrim() { if (scrim) scrim.hidden = true; }

  function openCart() {
    const c = $('[data-cart]');
    if (c) { c.hidden = false; showScrim(); document.body.style.overflow = 'hidden'; }
  }
  function closeAll() {
    const c = $('[data-cart]');
    const d = $('[data-drawer]');
    const s = $('[data-search-panel]');
    if (c) c.hidden = true;
    if (d) d.hidden = true;
    if (s) s.hidden = true;
    hideScrim();
    document.body.style.overflow = '';
  }

  /* ---------------- delegates ---------------- */
  document.addEventListener('click', async (e) => {
    const t = e.target;

    if (t.closest('[data-cart-open]')) { e.preventDefault(); await loadCart(); openCart(); return; }
    if (t.closest('[data-cart-close]')) { closeAll(); return; }
    if (t.closest('[data-drawer-open]')) { const d = $('[data-drawer]'); if (d) { d.hidden = false; showScrim(); } return; }
    if (t.closest('[data-drawer-close]')) { closeAll(); return; }
    if (t.closest('[data-search-open]')) {
      const s = $('[data-search-panel]');
      if (s) { s.hidden = false; showScrim(); setTimeout(() => $('[data-search-input]')?.focus(), 60); }
      return;
    }
    if (t.closest('[data-search-close]')) { closeAll(); return; }
    if (t === scrim) { closeAll(); return; }

    // cart quantity inside drawer / cart page
    const cq = t.closest('[data-cq]');
    if (cq) { await changeQty(cq.dataset.cq, Number(cq.dataset.d)); return; }
    const cr = t.closest('[data-cart-remove]');
    if (cr) { await removeLine(cr.dataset.cartRemove); if (location.pathname === '/cart') location.reload(); return; }
    const pcq = t.closest('[data-cart-qty]');
    if (pcq) {
      await changeQty(pcq.dataset.cartQty, Number(pcq.dataset.qty));
      if (location.pathname === '/cart') location.reload();
      return;
    }

    // product option select
    const opt = t.closest('.optbtn');
    if (opt) {
      const group = opt.closest('[data-opt]');
      const label = group.previousElementSibling?.querySelector('.opt__label span');
      $$('.optbtn', group).forEach((b) => b.classList.remove('is-on'));
      opt.classList.add('is-on');
      if (label) label.textContent = opt.dataset.value;
      return;
    }

    // qty stepper on PDP
    const qb = t.closest('[data-qty]');
    if (qb && !qb.dataset.cq) {
      const val = $('[data-qty-val]');
      if (val) val.textContent = Math.max(1, Math.min(20, Number(val.textContent) + Number(qb.dataset.qty)));
      return;
    }

    // add to bag
    const add = t.closest('[data-add]');
    if (add) {
      const metal = $('[data-opt="metal"] .optbtn.is-on')?.dataset.value || '';
      const size = $('[data-opt="size"] .optbtn.is-on')?.dataset.value || '';
      const qty = Number($('[data-qty-val]')?.textContent || 1);
      add.textContent = 'Adding…';
      await addToCart(add.dataset.id, metal, size, qty);
      add.textContent = 'Add to bag';
      return;
    }

    // accordion
    const accBtn = t.closest('.acc__btn');
    if (accBtn) {
      const item = accBtn.closest('.acc__item');
      const open = item.classList.contains('is-open');
      $$('.acc__item', item.parentElement).forEach((x) => x.classList.remove('is-open'));
      if (!open) item.classList.add('is-open');
      return;
    }
  });

  /* ---------------- forms ---------------- */
  document.addEventListener('submit', async (e) => {
    const f = e.target;

    if (f.hasAttribute('data-newsletter')) {
      e.preventDefault();
      const input = f.querySelector('input');
      if (!input.value) return;
      await fetch('/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: input.value }) });
      const html = '<p style="color:#fff;font-size:13px;margin-top:18px">You are in. Check your inbox for 15% off.</p>';
      f.insertAdjacentHTML('afterend', html);
      f.reset();
      f.remove();
      return;
    }

    if (f.hasAttribute('data-checkout')) {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]');
      const body = {};
      new FormData(f).forEach((v, k) => { body[k] = v; });
      if (!body.email) { alert('Email is required'); return; }
      btn.disabled = true;
      btn.textContent = 'Placing order…';
      const r = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.url) { location.href = j.url; }
      else { btn.disabled = false; btn.textContent = 'Try again'; alert(j.error || 'Something went wrong'); }
      return;
    }
  });

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      $('[data-search-open]')?.click();
    }
  });

  loadCart();
})();
