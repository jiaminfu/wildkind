/* ============================================================
   TIDEGLASS · 核心业务逻辑单元测试（不依赖浏览器）
   直接加载 data.js + core.js，用最小 DOM/localStorage 桩跑断言。
   目的：验证「赠品入库 / 库存二次校验 / 优惠券二次校验 /
        退款回补 / 单号唯一 / 邮箱归一」六条规则真的生效。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---------- 最小桩 ---------- */
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const noop = () => {};
const fakeEl = {
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop, getAttribute: () => null, appendChild: noop,
  querySelector: () => null, querySelectorAll: () => [],
  style: {}, dataset: {}, textContent: '', innerHTML: '',
};
const document = {
  addEventListener: noop,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => fakeEl,
  body: { classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop },
  activeElement: { tagName: 'BODY' },
};

const sandbox = {
  window: {},
  localStorage,
  document,
  console,
  Date,
  Math,
  JSON,
  setTimeout: noop,
  clearTimeout: noop,
  location: { hash: '#/' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---------- 加载源码 ---------- */
vm.runInContext(read('prototype/assets/js/data.js'), sandbox, { filename: 'data.js' });
vm.runInContext(read('prototype/assets/js/core.js'), sandbox, { filename: 'core.js' });
const S = sandbox.S;
const DB = S.DB;

/* ---------- 断言框架 ---------- */
let pass = 0, fail = 0;
const failures = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const stockOf = (pid, metal) => {
  const p = DB.products.find(x => x.id === pid || x.handle === pid);
  const v = p && p.variants.find(x => x.metal === metal);
  return v ? v.stock : -1;
};

/* ---------- 1. 单号唯一性 ---------- */
section('1 订单号生成');
const n1 = S.placeOrder; // 只取引用，实际单号通过下单观察
{
  // 构造一个极简订单上下文，只验证 nextOrderNumber 的单调性
  const before = DB.orders.map(o => o.number);
  const maxBefore = Math.max(...before.map(n => parseInt(String(n).replace(/\D+/g, ''), 10) || 0));
  S.addToCart(DB.products[0].id, DB.products[0].variants[0].metal, '', 2);
  const r = S.placeOrder({ email: 'unit@test.com', first: 'U', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  chk('下单成功', r.ok, r.ok ? r.order.number : r.msg);
  const num = r.order.number;
  chk('单号前缀为 #TG', /^#TG\d+$/.test(num), num);
  chk('单号大于库内最大号', parseInt(num.slice(3), 10) > maxBefore, num + ' > #' + maxBefore);
  chk('单号在库内唯一', DB.orders.filter(o => o.number === num).length === 1);
}

/* ---------- 2. 库存扣减 ---------- */
section('2 下单扣库存');
{
  const p = DB.products[1];
  const metal = p.variants[0].metal;
  const before = stockOf(p.id, metal);
  S.addToCart(p.id, metal, '', 3);
  const r = S.placeOrder({ email: 'unit@test.com', first: 'U', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  chk('下单成功', r.ok, r.msg || '');
  chk('库存按数量扣减', stockOf(p.id, metal) === before - 3, before + ' → ' + stockOf(p.id, metal));
}

/* ---------- 3. 库存不足整单拒绝 ---------- */
section('3 库存二次校验');
{
  const p = DB.products[2];
  const metal = p.variants[0].metal;
  // 绕过 addToCart 的库存校验，直接把超量行塞进购物车，模拟「加购后库存被买走」
  S.state.cart = [{ pid: p.id, metal, size: '', qty: p.variants[0].stock + 5 }];
  S.saveState();
  const r = S.placeOrder({ email: 'unit@test.com', first: 'U', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  chk('超量下单被拒绝', !r.ok, r.msg || '');
  chk('错误码为 OUT_OF_STOCK', r.code === 'OUT_OF_STOCK', r.code || '');
  chk('被拒绝时未产生订单', DB.orders[0].email !== 'unit@test.com' || DB.orders[0].items[0].productId !== p.id);
  chk('被拒绝时库存未变动', stockOf(p.id, metal) === p.variants[0].stock);
  S.state.cart = []; S.saveState();
}

/* ---------- 4. 赠品进单 ---------- */
section('4 满额赠品');
{
  const p = DB.products.find(x => x.price >= 60);
  const metal = p.variants[0].metal;
  const giftPid = DB.giftRule.sku;
  const giftStockBefore = stockOf(giftPid, DB.products.find(x => x.id === giftPid).variants[0].metal);
  const qty = Math.ceil((DB.giftRule.threshold + 10) / p.price);
  S.addToCart(p.id, metal, '', qty);
  const t = S.totals();
  chk('小计达到赠品门槛', t.giftUnlocked, '$' + t.subtotal.toFixed(2) + ' ≥ $' + DB.giftRule.threshold);
  const r = S.placeOrder({ email: 'gift@test.com', first: 'G', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  chk('下单成功', r.ok, r.msg || '');
  const giftItem = r.ok ? r.order.items.find(i => i.isGift) : null;
  chk('订单里含 0 元赠品行', !!giftItem, giftItem ? giftItem.title : '缺失');
  chk('赠品单价为 0', giftItem && giftItem.unitPrice === 0);
  chk('赠品数量为 1', giftItem && giftItem.qty === 1);
  chk('赠品库存已扣减', giftStockBefore > 0 && stockOf(giftPid, DB.products.find(x => x.id === giftPid).variants[0].metal) === giftStockBefore - 1,
    giftStockBefore + ' → ' + stockOf(giftPid, DB.products.find(x => x.id === giftPid).variants[0].metal));
  chk('订单记录了赠品信息', r.ok && !!r.order.gift, r.ok ? JSON.stringify(r.order.gift) : '');
}

/* ---------- 5. 优惠券二次校验 ---------- */
section('5 优惠券门槛二次校验');
{
  const c = DB.coupons.find(x => x.status === 'active' && x.minSubtotal > 0);
  if (!c) {
    chk('存在带门槛的有效优惠码', false, '数据里没有，跳过');
  } else {
    const p = DB.products.find(x => x.price >= c.minSubtotal * 0.5);
    S.addToCart(p.id, p.variants[0].metal, '', 1);
    S.state.coupon = c; S.saveState();
    // 把数量改成 1 件低价商品，使小计低于门槛
    S.setQty(p.id + '|' + p.variants[0].metal + '|', 1);
    const sub = S.totals().subtotal;
    if (sub >= c.minSubtotal) {
      chk('构造低于门槛的场景', false, '小计 $' + sub.toFixed(2) + ' 仍 ≥ 门槛 $' + c.minSubtotal + '，跳过');
      S.state.coupon = null; S.saveState();
    } else {
      const r = S.placeOrder({ email: 'coupon@test.com', first: 'C', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
      chk('低于门槛时下单被拒绝', !r.ok, r.msg || '');
      chk('错误码为 COUPON_INVALID', r.code === 'COUPON_INVALID', r.code || '');
      chk('失效券已从会话移除', S.state.coupon === null);
      S.state.cart = []; S.state.coupon = null; S.saveState();
    }
  }
}

/* ---------- 6. 退款回补 ---------- */
section('6 退款副作用');
{
  const p = DB.products.find(x => x.variants[0].stock >= 5);
  const metal = p.variants[0].metal;
  const stockBefore = stockOf(p.id, metal);
  S.addToCart(p.id, metal, '', 2);
  const r = S.placeOrder({ email: 'refund@test.com', first: 'R', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  chk('下单成功', r.ok, r.msg || '');
  const cust = DB.customers.find(c => c.email === 'refund@test.com');
  const spentAfterOrder = cust ? cust.spent : 0;
  const afterOrder = stockOf(p.id, metal);
  const rf = S.refundOrder(r.order.number);
  chk('退款成功', rf.ok, rf.ok ? 'refunded' : rf.msg);
  chk('库存已回补', stockOf(p.id, metal) === stockBefore, afterOrder + ' → ' + stockOf(p.id, metal));
  chk('客户消费额已冲减', cust && Math.abs(cust.spent - (spentAfterOrder - r.order.total)) < 0.011,
    spentAfterOrder + ' → ' + (cust ? cust.spent : 'n/a'));
  chk('记录退款时间', !!rf.order.refundedAt);
  chk('记录入库决策', rf.order.restockDecision === 'returned', rf.order.restockDecision || '');
  const again = S.refundOrder(r.order.number);
  chk('重复退款被拒绝', !again.ok && again.msg === 'Already refunded', again.msg || '');
  chk('重复退款不再回补库存', stockOf(p.id, metal) === stockBefore);
}

/* ---------- 7. 取消订单 ---------- */
section('7 取消订单');
{
  const p = DB.products.find(x => x.variants[0].stock >= 5);
  const metal = p.variants[0].metal;
  const before = stockOf(p.id, metal);
  S.addToCart(p.id, metal, '', 1);
  const r = S.placeOrder({ email: 'cancel@test.com', first: 'X', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  const c = S.cancelOrder(r.order.number);
  chk('取消成功', c.ok, c.ok ? 'cancelled' : c.msg);
  chk('库存已回补', stockOf(p.id, metal) === before, before + ' → ' + stockOf(p.id, metal));
  chk('状态为 cancelled', c.order.status === 'cancelled');
  const re = S.cancelOrder(r.order.number);
  chk('重复取消被拒绝', !re.ok && re.msg === 'Already cancelled', re.msg || '');
}

/* ---------- 8. 邮箱归一 ---------- */
section('8 邮箱大小写归一');
{
  const mail = 'Case.Test@Example.COM';
  const p = DB.products[0];
  S.addToCart(p.id, p.variants[0].metal, '', 1);
  const r1 = S.placeOrder({ email: mail, first: 'C', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  chk('订单邮箱已转小写', r1.ok && r1.order.email === 'case.test@example.com', r1.ok ? r1.order.email : r1.msg);
  const count1 = DB.customers.filter(c => String(c.email).toLowerCase() === 'case.test@example.com').length;
  S.addToCart(p.id, p.variants[0].metal, '', 1);
  S.placeOrder({ email: 'CASE.TEST@example.com', first: 'C', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Standard' });
  const count2 = DB.customers.filter(c => String(c.email).toLowerCase() === 'case.test@example.com').length;
  chk('同一邮箱不会建两个客户档案', count1 === 1 && count2 === 1, '档案数 ' + count2);
  const cust = DB.customers.find(c => String(c.email).toLowerCase() === 'case.test@example.com');
  chk('第二单累计到同一档案', cust && cust.orders === 2, cust ? 'orders=' + cust.orders : 'n/a');
}

/* ---------- 9. 配送方式与运费同源 ---------- */
section('9 配送方式与运费');
{
  const p = DB.products[0];
  S.state.checkoutData = { shipping: 'Standard' };
  S.addToCart(p.id, p.variants[0].metal, '', 1);
  const r = S.placeOrder({ email: 'ship@test.com', first: 'S', last: 'T', line1: 'x', city: 'y', state: 'CA', zip: '1', shipping: 'Express' });
  chk('订单配送方式 = 传入值', r.ok && r.order.shippingMethod === 'Express', r.ok ? r.order.shippingMethod : r.msg);
  chk('订单运费 = Express 运费', r.ok && Math.abs(r.order.shipping - DB.settings.expressShip) < 0.011,
    r.ok ? '$' + r.order.shipping : '');
  chk('会话配送方式已同步', S.state.checkoutData.shipping === 'Express', S.state.checkoutData.shipping);
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(48));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
