const { db, esc } = require('./core');

const NAV = [
  { key: 'overview', label: 'Overview', icon: 'grid' },
  { key: 'orders', label: 'Orders', icon: 'box' },
  { key: 'products', label: 'Products', icon: 'tag' },
  { key: 'inventory', label: 'Inventory', icon: 'layers' },
  { key: 'collections', label: 'Collections', icon: 'folder' },
  { key: 'customers', label: 'Customers', icon: 'users' },
  { key: 'content', label: 'Storefront', icon: 'layout' },
  { key: 'settings', label: 'Settings', icon: 'cog' },
];

const I = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  tag: '<path d="M3 12.5V4h8.5L21 13.5 12.5 22z"/><circle cx="7.5" cy="8" r="1.3"/>',
  layers: '<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 17 12 21.5 21 17"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M18 20c0-2.4-.7-4.2-2-5.4"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M9 9v11"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.6 7.5l2 1.2M17.4 15.3l2 1.2M4.6 16.5l2-1.2M17.4 8.7l2-1.2"/>',
};

const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${I[k] || ''}</svg>`;

function loginPage() {
  const d = db();
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · ${esc(d.settings.brandName)} Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Figtree:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/admin.css">
</head><body class="auth-body">
<div class="auth">
  <div class="auth__art">
    <img src="/assets/img/hero-necklaces.png" alt="">
    <div class="auth__artcopy">
      <p class="auth__eyebrow">Wildkind Studio</p>
      <h1>Run the shop<br>from one screen.</h1>
      <p>Orders, stock and storefront copy — all in one place, live.</p>
    </div>
  </div>
  <div class="auth__panel">
    <div class="auth__brand">Wildkind<span>admin</span></div>
    <h2>Sign in</h2>
    <p class="auth__sub">Use your studio account to manage the store.</p>
    <form data-login>
      <label>Email</label>
      <input name="email" value="studio@wildkind.co" autocomplete="username">
      <label>Password</label>
      <input name="password" type="password" placeholder="••••••••" autocomplete="current-password">
      <button class="abtn abtn--primary" type="submit" style="width:100%;margin-top:18px;height:46px">Sign in</button>
      <p class="auth__err" data-login-err hidden></p>
    </form>
    <div class="auth__demo">
      <p><b>Prototype access</b> — no real account needed. Password is <code>${esc(d.settings.adminPassword)}</code>.</p>
      <a href="/admin?demo=1" class="abtn abtn--ghost" style="width:100%;height:44px;margin-top:10px">Enter the demo panel →</a>
    </div>
  </div>
</div>
<script>
document.querySelector('[data-login]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.querySelector('[data-login-err]');
  const password = e.target.password.value;
  const r = await fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (r.ok) { location.href = '/admin'; }
  else { err.hidden = false; err.textContent = 'Password incorrect. Try wildkind2026'; }
});
document.querySelector('input[name=password]').focus();
</script>
</body></html>`;
}

function panel({ authed }) {
  if (!authed) return loginPage();
  const d = db();
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio · ${esc(d.settings.brandName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Figtree:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/admin.css">
</head><body>
<div class="adm">
  <aside class="adm__side">
    <a class="adm__brand" href="/admin"><span>Wildkind</span><em>studio</em></a>
    <nav class="adm__nav">
      ${NAV.map((n) => `<a href="#/${n.key}" data-nav="${n.key}">${svg(n.icon)}<span>${n.label}</span></a>`).join('')}
    </nav>
    <div class="adm__sidefoot">
      <div class="adm__store">
        <p class="adm__storename">${esc(d.settings.domain)}</p>
        <p class="adm__storemeta">${d.meta.productCount} products · ${d.meta.orderCount} orders</p>
      </div>
      <a class="adm__viewstore" href="/" target="_blank">View storefront ↗</a>
      <button class="adm__logout" data-logout>Sign out</button>
    </div>
  </aside>
  <div class="adm__main">
    <header class="adm__top">
      <div class="adm__crumb" id="crumb">Overview</div>
      <div class="adm__topright">
        <div class="adm__range" id="range">
          <button data-days="7">7d</button><button data-days="30" class="is-on">30d</button><button data-days="90">90d</button>
        </div>
        <span class="adm__pill">Live data</span>
        <span class="adm__avatar">WK</span>
      </div>
    </header>
    <div class="adm__view" id="view"><div class="adm__loading">Loading dashboard…</div></div>
  </div>
</div>
<div class="modal" id="modal" hidden><div class="modal__box" id="modal-box"></div></div>
<div class="atoast" id="toast"></div>
<script src="/assets/js/admin.js"></script>
</body></html>`;
}

/* ------------------- 原型总览页 ------------------- */
function prototypeIndex() {
  const shots = [
    ['Storefront', [
      ['/', 'Homepage', 'Hero, best sellers, nature tiles, reviews'],
      ['/collections/best-sellers', 'Collection', 'Filters, sort, product grid'],
      ['/products/solstice-sun-necklace', 'Product detail', 'Gallery, variants, accordion'],
      ['/cart', 'Cart', 'Line items, totals'],
      ['/checkout', 'Checkout', 'Address, payment, summary'],
      ['/account', 'Order lookup', 'Guest order tracking'],
      ['/pages/about', 'Brand story', 'Long-form editorial layout'],
      ['/pages/faq', 'FAQ', 'Accordion content'],
    ]],
    ['Admin', [
      ['/admin?demo=1#/overview', 'Overview', 'Revenue, margin, target, alerts'],
      ['/admin?demo=1#/orders', 'Orders', 'Table, filters, status flow'],
      ['/admin?demo=1#/products', 'Products', 'Inline edit, publish state'],
      ['/admin?demo=1#/inventory', 'Inventory', 'Cover weeks, low stock'],
      ['/admin?demo=1#/collections', 'Collections', 'Navigation tree'],
      ['/admin?demo=1#/customers', 'Customers', 'Lifetime value, repeat rate'],
      ['/admin?demo=1#/content', 'Storefront', 'Banner and copy editing'],
      ['/admin?demo=1#/settings', 'Settings', 'Cost model, thresholds'],
    ]],
  ];
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wildkind 原型总览</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400&family=Figtree:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Figtree,-apple-system,'Segoe UI',sans-serif;background:#f8f7f2;color:#14120f;-webkit-font-smoothing:antialiased}
.wrap{max-width:1500px;margin:0 auto;padding:48px 32px 72px}
h1{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:44px;letter-spacing:-.025em;margin:0 0 10px}
.lead{color:#736b63;font-size:15px;max-width:70ch;line-height:1.7;margin:0 0 8px}
.meta{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a9188;margin:26px 0 0}
h2{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:26px;letter-spacing:-.02em;margin:52px 0 18px;padding-bottom:12px;border-bottom:1px solid #e6ded4;display:flex;align-items:baseline;gap:12px}
h2 span{font-family:Figtree,sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9a9188}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.card{background:#fff;border:1px solid #e6ded4;overflow:hidden;transition:.25s;display:flex;flex-direction:column}
.card:hover{border-color:#14120f;transform:translateY(-2px);box-shadow:0 18px 40px -30px rgba(0,0,0,.4)}
.card__shot{height:250px;overflow:hidden;background:#f3e8de;position:relative}
.card__shot iframe{width:1400px;height:1000px;border:0;transform:scale(.25);transform-origin:0 0;pointer-events:none}
.card__body{padding:14px 16px 16px;border-top:1px solid #e6ded4}
.card__body h3{font-size:14px;margin:0 0 3px;font-weight:600}
.card__body p{font-size:11.5px;color:#736b63;margin:0;line-height:1.5}
.card__body a{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;border-bottom:1px solid #14120f;display:inline-block;margin-top:10px;padding-bottom:2px;color:#14120f;text-decoration:none}
.note{margin-top:48px;padding:20px 24px;border:1px solid #e6ded4;background:#fff;font-size:13px;color:#3c3733;line-height:1.7}
.note b{font-weight:600}
@media(max-width:1200px){.grid{grid-template-columns:repeat(2,1fr)}}
</style></head>
<body><div class="wrap">
<p class="meta">Prototype · v2</p>
<h1>Wildkind 原型总览</h1>
<p class="lead">参照 atoleajewelry.com 的信息架构重做：一级导航 11 项与参考站一一对应，前台 8 个页面 + 后台 8 个模块全部可交互。下面是每个页面的实时缩略图，点标题可打开完整页面。</p>
${shots.map(([group, list]) => `
  <h2>${group} <span>${list.length} screens</span></h2>
  <div class="grid">
    ${list.map(([href, name, desc]) => `
      <div class="card">
        <div class="card__shot"><iframe src="${href}" loading="lazy" tabindex="-1"></iframe></div>
        <div class="card__body">
          <h3>${name}</h3><p>${desc}</p>
          <a href="${href}" target="_blank">Open →</a>
        </div>
      </div>`).join('')}
  </div>`).join('')}
<div class="note">
  <b>后台登录：</b>直接点上方 Admin 的任意卡片（已带 <code>?demo=1</code> 自动登录），或访问 <code>/admin</code>，密码 <code>wildkind2026</code>。<br>
  <b>数据是真的：</b>前台下一单，后台订单和库存会立刻变；后台改价格，前台立刻生效。
</div>
</div></body></html>`;
}

module.exports = { panel, prototypeIndex, loginPage };
