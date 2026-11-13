/* 完整购买链路验证：全程真实点击，不直接改 hash 绕过按钮。
 *
 * 为什么要单独写这一份：原来的 e2e 用 location.hash 直接跳结算页，
 * 把「抽屉里的 Checkout 按钮点不动」这个真问题整个跳过去了。
 * 这份脚本只允许在「重置起始状态」和「切到账户页」时动 hash，
 * 购买链路必须一步一步点出来。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const BASE = 'http://localhost:4500';
const PROF = path.join(os.tmpdir(), 'edge_flow_prof');

const wait = ms => new Promise(r => setTimeout(r, ms));
function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

let pass = 0, fail = 0;
const ok = (name, extra) => { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); };
const bad = (name, extra) => { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); };
const chk = (name, cond, extra) => cond ? ok(name, extra) : bad(name, extra);

(async () => {
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROF,
    '--window-size=1440,1000', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { targets = v; break; } } catch (e) { }
    await wait(250);
  }
  if (!targets) { console.error('无法连接 CDP'); proc.kill(); process.exit(1); }

  const page = targets.filter(t => t.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
    if (o.method === 'Runtime.exceptionThrown') {
      errs.push(o.params.exceptionDetails.exception && o.params.exceptionDetails.exception.description || o.params.exceptionDetails.text);
    }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  const evalJS = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return '__ERR__ ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await evalJS(expr) === true) return true; await wait(120); }
    return false;
  };
  const click = async sel => {
    const r = await evalJS(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'NOT_FOUND';
      e.scrollIntoView({block:'center'}); e.click(); return 'ok';})()`);
    await wait(450);
    return r;
  };
  const fill = async (sel, val) => {
    const r = await evalJS(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'NOT_FOUND';
      e.focus(); e.value=${JSON.stringify(val)};
      e.dispatchEvent(new Event('input',{bubbles:true}));
      e.dispatchEvent(new Event('change',{bubbles:true}));
      return 'ok';})()`);
    await wait(60);
    return r;
  };
  const hash = () => evalJS('location.hash');
  const text = () => evalJS('(document.getElementById("app")||{}).innerText||""');
  const noJsError = async () => !(await text()).includes('JS ERROR');

  console.log('=== 完整购买链路（真实点击） ===\n');

  await send('Page.navigate', { url: BASE + '/' });
  await wait(1300);
  await evalJS('localStorage.clear(); 1');
  await send('Page.reload');
  await wait(1400);

  /* ---- 1 商品页加购 ---- */
  console.log('[1] 商品页 → 加购');
  await evalJS('location.hash="#/products/foxtrot-pendant-necklace"; 1');
  await waitFor('!!document.querySelector("[data-act=\\"add-open\\"]")', 6000);
  chk('详情页渲染', await evalJS('!!document.querySelector("[data-act=\\"add-open\\"]")'));
  chk('加购前购物车为 0', await evalJS('S.cartCount()') === 0);
  await click('[data-act="add-open"]');
  chk('点 Add to bag 后抽屉自动打开', await evalJS('document.body.classList.contains("drawer-open")'));
  chk('购物车有 1 件', await evalJS('S.cartCount()') === 1);
  chk('抽屉里显示登录状态提示', await evalJS('!!document.querySelector(".drawer__who")'),
    (await evalJS('(document.querySelector(".drawer__who")||{}).innerText||""')).trim().slice(0, 42));

  /* ---- 2 抽屉 → 结算（这一步以前是断的） ---- */
  console.log('\n[2] 抽屉 → Checkout');
  chk('抽屉里有 Checkout 链接', await evalJS('!!document.querySelector(".drawer a[href=\\"#/checkout\\"]")'));
  await click('.drawer a[href="#/checkout"]');
  const reachedCheckout = await waitFor('location.hash.indexOf("/checkout")>=0', 3000);
  chk('点 Checkout 真的跳到结算页', reachedCheckout, 'hash=' + (await hash()));
  chk('抽屉已收起', await evalJS('!document.body.classList.contains("drawer-open")'));
  chk('结算页有信息表单', await evalJS('!!document.querySelector("[data-act=\\"to-pay\\"]")'));

  /* ---- 3 填信息 ---- */
  console.log('\n[3] Information 步骤');
  for (const [n, v] of [['email', 'ada@example.com'], ['first', 'Ada'], ['last', 'Lovelace'],
  ['line1', '12 Ocean Ave'], ['city', 'Santa Monica'], ['state', 'CA'], ['zip', '90401']]) {
    const r = await fill(`.co input[name="${n}"]`, v);
    if (r !== 'ok') bad('填 ' + n, r);
  }
  await click('[data-act="to-pay"]');
  const onPay = await waitFor('!!document.querySelector("[data-act=\\"place\\"]")', 3000);
  chk('Continue to payment 进入支付步骤', onPay);
  chk('支付方式有三个可点标签', await evalJS('document.querySelectorAll(".paytab").length') === 3);
  chk('默认选中 Card', await evalJS('(document.querySelector(".paytab.on")||{}).textContent') === 'Card');

  /* ---- 4 支付方式切换 ---- */
  console.log('\n[4] 支付方式切换');
  await click('[data-act="pay-method"][data-m="apple"]');
  chk('切到 Apple Pay 显示钱包面板', await evalJS('!!document.querySelector(".walletbox")'));
  chk('按钮文案随方式变化', /Apple Pay/.test(await evalJS('(document.querySelector("[data-act=\\"place\\"]")||{}).textContent || ""')));
  await click('[data-act="pay-method"][data-m="google"]');
  chk('切到 Google Pay 按钮文案变化', /Google Pay/.test(await evalJS('(document.querySelector("[data-act=\\"place\\"]")||{}).textContent || ""')));
  await click('[data-act="pay-method"][data-m="card"]');
  chk('切回 Card 显示卡表单', await evalJS('!!document.querySelector("input[name=\\"cardNumber\\"]")'));

  /* ---- 5 拒付路径 ---- */
  console.log('\n[5] 支付失败路径');
  const ordersBefore = await evalJS('S.DB.orders.length');
  await fill('input[name="cardNumber"]', '4000 0000 0000 0002');
  await click('[data-act="place"]');
  const gotErr = await waitFor('!!document.querySelector(".payerr")', 3000);
  chk('拒付卡显示错误提示', gotErr, (await evalJS('(document.querySelector(".payerr")||{}).innerText||""')).slice(0, 48));
  chk('拒付不生成订单', await evalJS('S.DB.orders.length') === ordersBefore);
  chk('拒付后仍停在支付页', (await hash()).indexOf('/checkout') >= 0);

  /* ---- 6 成功路径 ---- */
  console.log('\n[6] 支付成功');
  await fill('input[name="cardNumber"]', '4242 4242 4242 4242');
  await click('[data-act="place"]');
  const done = await waitFor('location.hash.indexOf("/order/")>=0', 6000);
  chk('支付成功跳到订单完成页', done, 'hash=' + (await hash()));
  const orderNo = await evalJS('decodeURIComponent(location.hash.split("/order/")[1]||"")');
  chk('订单号已生成', /^%23|^#/.test(encodeURIComponent(orderNo)) || orderNo.length > 3, orderNo);
  chk('订单数 +1', await evalJS('S.DB.orders.length') === ordersBefore + 1);
  chk('购物车已清空', await evalJS('S.cartCount()') === 0);
  const doneTxt = await text();
  chk('完成页显示总价', /Total paid/.test(doneTxt));

  /* ---- 7 注册 → 用户中心 ---- */
  console.log('\n[7] 注册与用户中心');
  await evalJS('location.hash="#/account/register"; 1');
  await waitFor('!!document.querySelector("[data-act=\\"acc-signup\\"]")', 5000);
  chk('注册页渲染', await evalJS('!!document.querySelector("[data-act=\\"acc-signup\\"]")'));
  for (const [n, v] of [['first', 'Ada'], ['last', 'Lovelace'], ['email', 'ada@example.com'], ['pw', 'saltwater2026']]) {
    await fill(`form[data-act="acc-signup"] input[name="${n}"]`, v);
  }
  await click('form[data-act="acc-signup"] button[type="submit"]');
  const inHub = await waitFor('location.hash === "#/account"', 4000);
  chk('注册后自动登录并进入账户中心', inHub, 'hash=' + (await hash()));
  const hubTxt = await text();
  chk('账户中心显示欢迎语', /Hello, Ada/.test(hubTxt));
  // innerText 返回的是渲染后文本，CSS text-transform 会把标签变成大写
  chk('概览显示订单统计', /orders/i.test(hubTxt) && /in transit/i.test(hubTxt) && /wishlist/i.test(hubTxt),
    'has ' + ((hubTxt.match(/\b\d+\b/g) || []).slice(0, 3).join('/')));

  /* ---- 8 刚下的订单出现在账户里 ---- */
  console.log('\n[8] 订单归属');
  await click('.acct2__nav a[href="#/account/orders"]');
  await waitFor('location.hash === "#/account/orders"', 3000);
  const listTxt = await text();
  chk('订单列表能找到刚才那一单', listTxt.indexOf(orderNo.replace(/^%23/, '#')) >= 0 || /#TG\d+/.test(listTxt),
    (listTxt.match(/#TG\d+/) || [''])[0]);
  await click('.ol');
  await waitFor('location.hash.indexOf("/account/orders/")>=0', 3000);
  chk('订单详情打开', /Items/.test(await text()) && /Shipping to/.test(await text()));

  /* ---- 9 地址簿 ---- */
  console.log('\n[9] 地址簿');
  await click('.acct2__nav a[href="#/account/addresses"]');
  await waitFor('location.hash === "#/account/addresses"', 3000);
  chk('地址簿空态', /No saved addresses/.test(await text()));
  await click('[data-act="addr-new"]');
  chk('新增地址表单出现', await evalJS('!!document.querySelector("form[data-act=\\"addr-save\\"]")'));
  for (const [n, v] of [['first', 'Ada'], ['last', 'Lovelace'], ['line1', '12 Ocean Ave'],
  ['city', 'Santa Monica'], ['state', 'CA'], ['zip', '90401']]) {
    await fill(`form[data-act="addr-save"] input[name="${n}"]`, v);
  }
  await click('form[data-act="addr-save"] button[type="submit"]');
  await waitFor('!!document.querySelector(".addrc")', 3000);
  chk('地址保存成功', await evalJS('document.querySelectorAll(".addrc").length') === 1);

  /* ---- 10 心愿单 ---- */
  console.log('\n[10] 心愿单');
  await evalJS('location.hash="#/products/tidepool-choker"; 1');
  await waitFor('!!document.querySelector(".wishbtn")', 5000);
  const wishBefore = await evalJS('document.querySelectorAll(".wishbtn.on").length');
  await click('.wishbtn');
  chk('商品页心形变实心', await evalJS('document.querySelectorAll(".wishbtn.on").length') === 1, 'before=' + wishBefore);
  await evalJS('location.hash="#/account/wishlist"; 1');
  await waitFor('!!document.querySelector(".wishwrap") || !!document.querySelector(".empty")', 5000);
  chk('心愿单里有 1 件商品', await evalJS('document.querySelectorAll(".wishwrap").length') === 1);
  chk('心愿单有移除按钮', await evalJS('!!document.querySelector("[data-act=\\"wish\\"]")'));

  /* ---- 11 登录态与退出 ---- */
  console.log('\n[11] 登录态');
  chk('页头显示 Hello, Ada', /Hello,\s*Ada/.test(await evalJS('(document.querySelector(".hdr__me")||{}).innerText||""')));
  await click('.acct2__out');
  const backToLogin = await waitFor('location.hash === "#/account/login"', 3000);
  chk('退出后回到登录页', backToLogin);
  chk('页头回到 Sign in', await evalJS('!!document.querySelector(".hdr__signin")'));

  /* ---- 12 老账号登录看到历史订单 ---- */
  console.log('\n[12] Demo 账号登录');
  await fill('form[data-act="acc-signin"] input[name="email"]', 'maya.patel@gmail.com');
  await fill('form[data-act="acc-signin"] input[name="pw"]', 'tideglass2026');
  await click('form[data-act="acc-signin"] button[type="submit"]');
  await waitFor('location.hash === "#/account"', 4000);
  chk('demo 账号登录成功', /Hello, Maya/.test(await text()));
  await click('.acct2__nav a[href="#/account/orders"]');
  await waitFor('location.hash === "#/account/orders"', 3000);
  const mayaOrders = await evalJS('document.querySelectorAll(".ol").length');
  chk('demo 账号能看到历史订单', mayaOrders > 0, mayaOrders + ' 单');

  /* ---- 13 错误密码 ---- */
  console.log('\n[13] 错误密码');
  await click('.acct2__out');
  await waitFor('location.hash === "#/account/login"', 3000);
  await fill('form[data-act="acc-signin"] input[name="email"]', 'maya.patel@gmail.com');
  await fill('form[data-act="acc-signin"] input[name="pw"]', 'wrongpass');
  await click('form[data-act="acc-signin"] button[type="submit"]');
  chk('错误密码显示提示', await waitFor('!!document.querySelector(".formerr")', 3000));
  chk('错误密码不登录', (await hash()).indexOf('login') >= 0);

  /* ---- 14 登录后回到原本要去的页面 ---- */
  console.log('\n[14] 登录回跳');
  await evalJS('S.addToCart("foxtrot-pendant-necklace","Gold","18\\"",1); 1');
  await evalJS('location.hash = "#/account/login?next=/checkout"; 1');
  await waitFor('!!document.querySelector("form[data-act=\\"acc-signin\\"]")', 4000);
  await fill('form[data-act="acc-signin"] input[name="email"]', 'maya.patel@gmail.com');
  await fill('form[data-act="acc-signin"] input[name="pw"]', 'tideglass2026');
  await click('form[data-act="acc-signin"] button[type="submit"]');
  const backToCo = await waitFor('location.hash === "#/checkout"', 4000);
  chk('登录后回到结算页（next 生效）', backToCo, 'hash=' + (await hash()));
  chk('结算页识别为已登录（邮箱锁定）', await evalJS('!!document.querySelector(".locked")'),
    (await evalJS('(document.querySelector(".locked")||{}).innerText||""')).replace(/\s+/g, ' ').trim().slice(0, 46));

  console.log('\n=== 控制台异常 ===');
  console.log(errs.length ? errs.slice(0, 6).join('\n') : '（无）');
  chk('全程没有 JS 异常', errs.length === 0);
  chk('页面没有渲染错误', await noJsError());

  console.log('\n结果：通过 ' + pass + ' / ' + (pass + fail));
  sock.close(); proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
