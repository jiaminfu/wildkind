/* ============================================================
   清理测试残留数据
   ------------------------------------------------------------
   为什么需要这个工具：
   自动化测试（api-test / accept-* / e2e-* / 支付冒烟）会真的下单、
   建定制单、改设置。每跑一次，后台就多出几张假订单、几个假客户，
   看板上的 GMV、客单价、转化率跟着一起失真。跑到后来没人敢信后台数字，
   这比没有报表更糟。

   用法：
     node tools/clean-test-data.js                  # 预演，只报告不动手（默认）
     node tools/clean-test-data.js --apply          # 真删，删前自动备份
     node tools/clean-test-data.js --apply --seed   # 删完把结果存成新的基线快照
     node tools/clean-test-data.js --apply --keep-tax   # 保留销售税配置（不动它）

   判定口径（宁可漏删，不可错删）：
     · 邮箱命中测试模式 → 该订单 / 定制单 / 客户 都算残留
     · 已过期的报价单（quotes）→ 删，它们本来就该在 15 分钟后失效
     · 幂等键指向已被删订单的 → 删，否则下次撞键会查到一张不存在的单
     · 库存流水中指向已删订单的条目 → 删
     · 过期后台会话 → 删
     · 销售税配置：只有 demo 州（CA/NY/TX/OR）且无备注时视为测试残留

   绝不会动的东西：
     · 商品（含上下架、价格、库存）—— 新品也是商品，不能因为"基线里没有"就删
     · 订单号序列（sequences）—— 回退会导致新单撞上历史单号
     · 审计日志（auditLog）—— 删审计等于销毁证据
     · 员工账号（staff）
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'app', 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'db.seed.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const WRITE_SEED = args.includes('--seed');
const KEEP_TAX = args.includes('--keep-tax');

/* ---- 测试数据识别规则 ----
   用「域名 + 局部前缀」两段判断，而不是精确邮箱列表：
   测试脚本每次都会生成随机后缀（az.refund.n6edj@example.com），
   精确列表永远追不上。 */
const TEST_DOMAINS = ['example.com', 'example.net', 'example.org', 'test.com', 'test.local'];
const TEST_LOCAL_PREFIX = /^(az|ui|e2e|qa|smoke|apitest|accept|diag|probe)[._-]/i;
/* 精确黑名单：老脚本留下的、不符合上面模式的地址 */
const TEST_EMAILS = new Set([
  'pay-smoke@lastgrove.com',
  'smoke@lastgrove.com',
  'x@y.com',
  'apitest@example.com',
]);

function isTestEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email) return false;
  if (TEST_EMAILS.has(email)) return true;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (TEST_DOMAINS.includes(domain)) return true;
  if (TEST_LOCAL_PREFIX.test(local)) return true;
  return false;
}

/* ---- 销售税残留判定 ----
   后台配了税率是商家的真实决定，不能随便抹。但测试跑出来的
   {CA,NY,TX,OR} 四个州 + 空备注，是脚本写的，不是人配的。 */
const DEMO_TAX_STATES = ['CA', 'NY', 'TX', 'OR'];
function taxLooksLikeResidue(tax) {
  if (!tax || typeof tax !== 'object') return false;
  if (!tax.enabled) return false;
  const codes = Object.keys(tax.rates || {});
  if (!codes.length) return false;
  if (String(tax.note || '').trim()) return false;          // 有备注 = 人动过，别碰
  return codes.every(c => DEMO_TAX_STATES.includes(c));
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const now = Date.now();

/* ---------------- 1. 订单 ---------------- */
const dropOrders = (db.orders || []).filter(o => isTestEmail(o.email));
const dropOrderNums = new Set(dropOrders.map(o => o.number));
const keepOrders = (db.orders || []).filter(o => !dropOrderNums.has(o.number));

/* ---------------- 2. 客户 ----------------
   客户表是从订单派生的汇总。测试订单删了，对应的客户记录就成了
   「0 单、$0、New」的幽灵行，会一直挂在后台客户列表里。 */
const dropCustomers = (db.customers || []).filter(c => {
  if (isTestEmail(c.email)) return true;
  /* 不按「没订单就删」来判断：真实客户也可能先注册后下单。
     只删邮箱命中测试模式的。 */
  return false;
});
const dropCustomerEmails = new Set(dropCustomers.map(c => String(c.email || '').toLowerCase()));
const dropCustomerIds = new Set(dropCustomers.map(c => c.id));
const keepCustomers = (db.customers || []).filter(c => !dropCustomerIds.has(c.id));

/* ---------------- 3. 定制需求单 ---------------- */
const dropRequests = (db.customRequests || []).filter(r => isTestEmail(r.email));
const dropRequestIds = new Set(dropRequests.map(r => r.id));
const keepRequests = (db.customRequests || []).filter(r => !dropRequestIds.has(r.id));

/* ---------------- 4. 优惠码 / 集合 ----------------
   测试会建 APITEST20 之类的码；正常业务码不匹配这个模式。 */
const dropCoupons = (db.coupons || []).filter(c => /^(apitest|test|e2e|qa)[-_]?\d*/i.test(c.code));
const dropCouponCodes = new Set(dropCoupons.map(c => c.code));
const keepCoupons = (db.coupons || []).filter(c => !dropCouponCodes.has(c.code));

const dropCollections = (db.collections || []).filter(c => /^(api-test|test-|e2e-|qa-)/i.test(c.handle));
const dropCollectionHandles = new Set(dropCollections.map(c => c.handle));
const keepCollections = (db.collections || []).filter(c => !dropCollectionHandles.has(c.handle));

/* ---------------- 5. 过期报价 ----------------
   报价单 15 分钟过期，正常情况下服务端会在下次访问时清掉。
   但测试跑完没人再访问，就会一直堆着。 */
const dropQuotes = (db.quotes || []).filter(q => !q.expiresAt || Date.parse(q.expiresAt) < now);
const keepQuotes = (db.quotes || []).filter(q => q.expiresAt && Date.parse(q.expiresAt) >= now);

/* ---------------- 6. 幂等键 ---------------- */
const idem = db.idempotency || {};
const dropIdemKeys = Object.keys(idem).filter(k => {
  const v = idem[k] || {};
  return v.orderNumber && dropOrderNums.has(v.orderNumber);
});
const keepIdem = {};
for (const k of Object.keys(idem)) if (!dropIdemKeys.includes(k)) keepIdem[k] = idem[k];

/* ---------------- 7. 库存流水 ----------------
   指向已删订单的流水必须一起删，否则「流水对不上库存」会永远对不上。 */
const dropLedger = (db.stockLedger || []).filter(l => l.refId && dropOrderNums.has(l.refId));
const dropLedgerIds = new Set(dropLedger.map(l => l.id));
const keepLedger = (db.stockLedger || []).filter(l => !dropLedgerIds.has(l.id));

/* ---------------- 8. 后台会话 ---------------- */
const dropSessions = (db.sessions || []).filter(s => !s.expiresAt || Date.parse(s.expiresAt) < now);
const keepSessions = (db.sessions || []).filter(s => s.expiresAt && Date.parse(s.expiresAt) >= now);

/* ---------------- 9. 销售税配置 ---------------- */
const taxResidue = !KEEP_TAX && taxLooksLikeResidue((db.settings || {}).tax);

/* ---------------- 报告 ---------------- */
const money = n => '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
function row(label, del, keep, extra) {
  console.log('  ' + String(label).padEnd(16) + '删 ' + String(del).padStart(4) +
    '  / 留 ' + String(keep).padStart(4) + (extra ? '   ' + extra : ''));
}

console.log('\n清理测试残留 ' + (APPLY ? '【实际执行】' : '【预演，不会改动任何数据】'));
console.log('数据文件：' + DB_FILE + '\n');

const dropGmv = dropOrders.filter(o => o.status !== 'cancelled' && o.status !== 'pending_payment')
  .reduce((s, o) => s + Number(o.total || 0), 0);

if (dropOrders.length) {
  console.log('  将被删除的订单：');
  for (const o of dropOrders.slice().sort((a, b) => b.number.localeCompare(a.number))) {
    console.log('    ' + o.number + '  ' + o.status.padEnd(15) + money(o.total).padStart(8) + '  ' + o.email);
  }
  console.log('');
}

row('订单', dropOrders.length, keepOrders.length, '约占 GMV ' + money(dropGmv));
row('客户', dropCustomers.length, keepCustomers.length);
row('定制需求单', dropRequests.length, keepRequests.length);
row('优惠码', dropCoupons.length, keepCoupons.length, dropCouponCodes.size ? [...dropCouponCodes].join(',') : '');
row('集合', dropCollections.length, keepCollections.length, dropCollectionHandles.size ? [...dropCollectionHandles].join(',') : '');
row('过期报价', dropQuotes.length, keepQuotes.length);
row('幂等键', dropIdemKeys.length, Object.keys(keepIdem).length);
row('库存流水', dropLedger.length, keepLedger.length);
row('过期会话', dropSessions.length, keepSessions.length);
if (taxResidue) {
  console.log('  ' + '销售税配置'.padEnd(16) + '将重置为关闭、清空州税率（' +
    Object.keys(db.settings.tax.rates).join('/') + '）。要保留请加 --keep-tax');
}
console.log('  ' + '商品'.padEnd(16) + '不动（' + (db.products || []).length + ' 款全部保留）');
console.log('  ' + '单号序列'.padEnd(16) + '不动（下一个仍是 #TG' + ((db.sequences || {}).order || '?') + '）');

if (!APPLY) {
  console.log('\n以上为预演。确认无误后加 --apply 执行（会自动备份）。\n');
  process.exit(0);
}

const nothingToDo = !dropOrders.length && !dropCustomers.length && !dropRequests.length &&
  !dropCoupons.length && !dropCollections.length && !dropQuotes.length && !dropIdemKeys.length &&
  !dropLedger.length && !dropSessions.length && !taxResidue;
if (nothingToDo) {
  console.log('\n没有需要清理的数据，未做任何改动。\n');
  process.exit(0);
}

/* ---------------- 落盘 ---------------- */
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(DATA_DIR, 'db.bak-before-clean-' + stamp + '.json');
fs.copyFileSync(DB_FILE, backup);
console.log('\n已备份 → ' + backup);

const out = Object.assign({}, db, {
  orders: keepOrders,
  customers: keepCustomers,
  customRequests: keepRequests,
  coupons: keepCoupons,
  collections: keepCollections,
  quotes: keepQuotes,
  idempotency: keepIdem,
  stockLedger: keepLedger,
  sessions: keepSessions,
});
if (taxResidue) {
  out.settings = Object.assign({}, out.settings, {
    tax: { enabled: false, rates: {}, shipTaxable: true, note: '' },
  });
}

/* 写临时文件再 rename：中途断电不会留下半个 JSON。
   这个库是单文件存储，写坏了整个站就打不开——这种事发生一次就够。 */
const tmp = DB_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(out, null, 1), 'utf8');
fs.renameSync(tmp, DB_FILE);
console.log('已写入 → ' + DB_FILE);

if (WRITE_SEED) {
  /* 基线快照 = api-test 复位时要回去的样子。
     不清库就重置，等于把测试残留一遍遍刻进基线里。 */
  fs.copyFileSync(DB_FILE, SEED_FILE);
  console.log('已刷新基线快照 → ' + SEED_FILE + '（' +
    out.products.length + ' 款商品 / ' + out.orders.length + ' 单）');
} else {
  console.log('提示：加 --seed 可同时把清理后的状态存成基线快照，后续 --test/reset 会回到这里');
}

console.log('\n完成。服务在运行的话无需重启（库是读内存 + 落盘，下次请求即生效）。\n');
