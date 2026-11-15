/* ============================================================
   LASTGROVE · 在线上站点建一笔真实沙盒订单，取回 PayPal 批准链接
   ------------------------------------------------------------
   为什么要脚本建单而不是手点：手点会顺手改库存、用真邮箱、留下更难认的脏数据。
   这里固定用 $1 档商品 + 测试邮箱，单号打在输出里，联调完可按单号清理。

   流程与前台完全一致（不绕过任何校验）：
     POST /checkout/quote  → 服务端重新定价
     POST /orders          → 202 + payment.approveUrl
   唯一区别是省掉了「加购物车 → 填地址 → 点提交」的人工步骤。

   用法：
     node tools/pp-live-order.js                       # 默认线上
     BASE_URL=http://localhost:4600 node tools/pp-live-order.js
   ============================================================ */
'use strict';

const BASE = process.env.BASE_URL || 'https://lastgrove.com';

/* 用内置 fetch 而不是手搓 http.request：
   手搓版给 GET 也带上 Content-Length: 0，过 Cloudflare 时会一路等到超时
   （同一请求 curl 只要 5.8s）。fetch 的 keep-alive 与压缩协商都是现成的。 */
async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'LASTGROVE-pay-smoke/1.0',
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
}

/* 挑一件有货、单价最低的变体：沙盒测试金额越小越好对账。
   注意列表接口的 data 直接是数组（不是 {items}），且不下发 active 字段
   —— 服务端已经过滤过下架商品，这里只需要看变体有没有货。 */
function pickCheapest(products) {
  let best = null;
  (products || []).forEach(p => {
    (p.variants || []).forEach(v => {
      if (!(v.stock > 0) || v.inStock === false) return;
      if (!best || v.price < best.price) {
        best = { productId: p.id, title: p.title, metal: v.metal, price: v.price, stock: v.stock };
      }
    });
  });
  return best;
}

(async () => {
  const list = await req('GET', '/api/v1/products?limit=200');
  if (list.status !== 200) throw new Error('拉商品失败 HTTP ' + list.status);
  const payload = (list.json && list.json.data) || [];
  const items = Array.isArray(payload) ? payload : (payload.items || []);
  const pick = pickCheapest(items);
  if (!pick) throw new Error('没有可售商品');

  console.log('商品：%s（%s） $%s', pick.title, pick.metal, pick.price);

  const quote = await req('POST', '/api/v1/checkout/quote', {
    items: [{ productId: pick.productId, metal: pick.metal, qty: 1 }],
    shippingMethod: 'Standard',
  });
  if (quote.status !== 200) {
    console.log('报价失败：', JSON.stringify(quote.json));
    process.exit(1);
  }
  const q = quote.json.data;
  console.log('报价：subtotal $%s + 运费 $%s = $%s（quote %s）',
    q.subtotal, q.shipping, q.total, q.quoteId);

  const stamp = Date.now().toString(36).slice(-6);
  const order = await req('POST', '/api/v1/orders', {
    quoteId: q.quoteId,
    email: 'pay-smoke+' + stamp + '@lastgrove.com',
    firstName: 'Sandbox',
    lastName: 'Buyer',
    line1: '1 Test Street',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    country: 'United States',
    shipping: 'Standard',
    address: { line1: '1 Test Street', city: 'Austin', state: 'TX', zip: '78701', country: 'United States' },
  });

  if (order.status !== 202) {
    console.log('建单失败 HTTP %s：%s', order.status, JSON.stringify(order.json).slice(0, 400));
    process.exit(1);
  }

  const o = order.json.data.order;
  const pay = order.json.data.payment || {};
  console.log('\n订单：%s  状态：%s  金额：$%s', o.number, o.status, o.total);
  console.log('通道：%s  mode：%s', pay.provider, pay.mode);
  console.log('sessionId：%s', pay.sessionId);
  console.log('\n批准链接（沙盒买家登录后点 Pay）：\n%s\n', pay.approveUrl);
  console.log('核对命令：curl -s "%s/api/v1/orders/%s?email=%s"',
    BASE, encodeURIComponent(o.number), encodeURIComponent(o.email));
})().catch(e => {
  console.error('失败：', e.message);
  process.exit(1);
});
