/* ============================================================
   TIDEGLASS · Stripe 通道
   ------------------------------------------------------------
   零依赖实现：本仓库不带任何 npm 包，所以这里直接用 node:https 调 REST，
   自己算 webhook 的 HMAC 签名，不引入 stripe-node。

   接入形态是 Embedded Checkout（PRD FR-S-076「Stripe 内嵌」）：
   创建 session 时 ui_mode=embedded，把 client_secret 交给前端
   stripe.initEmbeddedCheckout()，卡片信息始终在 Stripe 的 iframe 里，
   我们的服务器和浏览器都碰不到卡号。

   需要的环境变量：
     STRIPE_SECRET_KEY        sk_test_… / sk_live_…（只在服务端）
     STRIPE_WEBHOOK_SECRET    whsec_…（后台 Webhook 端点页复制）

   金额处理：line item 只传一条，unit_amount = 订单总额（分）。
   不逐条传商品，是因为本站有赠品（单价 0）、优惠券、免邮门槛三套叠加，
   拆成多条 line item 时要靠 coupon 去补差额，任何一处舍入不一致都会导致
   「结算页 $214、实际扣 $238」——这正是本项目 checkout.js 里第一条铁律要防的。
   明细放进 metadata，收据上保留订单号与件数。
   ============================================================ */
'use strict';
const https = require('https');
const crypto = require('crypto');

const HOST = 'api.stripe.com';
const TOLERANCE_SEC = 300;   // webhook 时间戳容忍窗口，防重放

function secretKey() {
  return String(process.env.STRIPE_SECRET_KEY || '').trim();
}

function webhookSecret() {
  return String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

/* 把嵌套对象压成 Stripe 要的 form 编码：{a:{b:1}} → a[b]=1 */
function form(obj) {
  const out = [];
  const walk = (v, k) => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, k + '[' + i + ']'));
    if (typeof v === 'object') return Object.keys(v).forEach(kk => walk(v[kk], k + '[' + kk + ']'));
    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  };
  Object.keys(obj || {}).forEach(k => walk(obj[k], k));
  return out.join('&');
}

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? '' : form(body);
    const req = https.request({
      hostname: HOST,
      port: 443,
      path: path,
      method: method,
      timeout: 20000,
      headers: Object.assign({
        'Authorization': 'Bearer ' + secretKey(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'Stripe-Version': '2024-06-20',
      }),
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON 走下面的兜底 */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
        const detail = (json && json.error) || {};
        const err = new Error('Stripe: ' + (detail.message || ('HTTP ' + res.statusCode)));
        /* 上游 4xx 是我们的参数问题，不该让调用方以为可以重试；
           502 表示 Stripe 侧异常，调用方可提示用户稍后再试。 */
        err.status = res.statusCode >= 500 ? 502 : 502;
        err.code = 'STRIPE_ERROR';
        err.detail = detail;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Stripe request timed out after 20s')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (!ba.length || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  id: 'stripe',
  label: 'Stripe',
  supports: ['card', 'apple_pay', 'google_pay', 'link'],
  isAsync: true,

  isConfigured() {
    return /^sk_(test|live)_/.test(secretKey()) && /^whsec_/.test(webhookSecret());
  },

  isLive() {
    return /^sk_live_/.test(secretKey());
  },

  /* ctx: { orderNumber, amount, currency, email, description, returnUrl, meta } */
  async createSession(ctx) {
    const c = ctx || {};
    const amount = Math.round(Number(c.amount || 0) * 100);

    if (!Number.isFinite(amount) || amount <= 0) {
      const e = new Error('Order total must be greater than zero.');
      e.status = 422;
      e.code = 'AMOUNT_INVALID';
      throw e;
    }
    /* Stripe 的最低收款额随币种不同（USD 是 $0.50）。
       低于门槛时 Stripe 会直接拒绝，与其让用户在下单最后一步看到英文报错，
       不如在报价阶段就拦住 —— 这条与 FRD BR-17 的最低金额约束一致。 */
    if (String(c.currency || 'usd').toLowerCase() === 'usd' && amount < 50) {
      const e = new Error('Order total is below the card network minimum (US$0.50).');
      e.status = 422;
      e.code = 'AMOUNT_TOO_SMALL';
      throw e;
    }

    const base = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
    const returnUrl = c.returnUrl || (base + '/#/order/confirm?session_id={CHECKOUT_SESSION_ID}');

    const session = await call('POST', '/v1/checkout/sessions', {
      mode: 'payment',
      ui_mode: 'embedded',
      customer_email: c.email || undefined,
      return_url: returnUrl,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(c.currency || 'usd').toLowerCase(),
          unit_amount: amount,
          product_data: {
            name: c.description || ('TIDEGLASS order ' + (c.orderNumber || '')),
          },
        },
      }],
      /* 订单号同时写进 session 与 payment_intent 的 metadata：
         session 用于 webhook 反查订单，payment_intent 用于后台退款时对账。
         ref 是「落库前就存在的关联键」——真实通道必须先建支付会话才能知道钱有没有到，
         而订单要等会话建好才落库，中间需要一个两边都认的标识。 */
      metadata: Object.assign({ ref: c.ref || '', orderNumber: c.orderNumber || '' }, c.meta || {}),
      payment_intent_data: {
        metadata: Object.assign({ ref: c.ref || '', orderNumber: c.orderNumber || '' }, c.meta || {}),
      },
      /* 收银台语言跟随买家，卡组织拒绝时的提示才有意义 */
      locale: c.locale || 'auto',
    });

    return {
      mode: 'embedded',
      payment: {
        provider: 'stripe',
        mode: this.isLive() ? 'live' : 'test',
        reference: String(session.id || ''),
        last4: '',
      },
      sessionId: session.id,
      clientSecret: session.client_secret,
    };
  },

  /* rawBody 必须是原始字节的字符串，不能是 JSON.parse 之后的对象——
     任何空格、键序的重新序列化都会让签名对不上。 */
  async verifyWebhook(rawBody, headers) {
    const h = headers || {};
    const sigHeader = String(h['stripe-signature'] || '');
    const secret = webhookSecret();

    if (!secret) return { ok: false, reason: 'STRIPE_WEBHOOK_SECRET is not set.' };
    if (!sigHeader) return { ok: false, reason: 'Missing Stripe-Signature header.' };

    let ts = '';
    const sigs = [];
    sigHeader.split(',').forEach(part => {
      const i = part.indexOf('=');
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k === 't') ts = v;
      else if (k === 'v1') sigs.push(v);
    });

    if (!ts || !sigs.length) return { ok: false, reason: 'Malformed Stripe-Signature header.' };

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (!Number.isFinite(age) || age > TOLERANCE_SEC) {
      return { ok: false, reason: 'Webhook timestamp outside the ' + TOLERANCE_SEC + 's tolerance.' };
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(ts + '.' + rawBody, 'utf8')
      .digest('hex');

    const matched = sigs.some(s => safeEqualHex(s, expected));
    if (!matched) return { ok: false, reason: 'Signature mismatch.' };

    let event = null;
    try { event = JSON.parse(rawBody); }
    catch (e) { return { ok: false, reason: 'Body is not valid JSON.' }; }

    const obj = (event && event.data && event.data.object) || {};
    const type = String(event.type || '');

    /* 只认「钱确实到位」的事件，其余一律不改变订单状态。
       特别注意 checkout.session.completed 在异步支付方式（如某些本地钱包）下
       并不代表已收款，必须看 payment_status。 */
    let status = null;
    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      status = (obj.payment_status === 'paid' || type === 'checkout.session.async_payment_succeeded')
        ? 'paid' : null;
    } else if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') {
      status = 'failed';
    } else if (type === 'charge.refunded' || type === 'refund.updated') {
      status = 'refunded';
    }

    const meta = obj.metadata || {};
    return {
      ok: true,
      event: type,
      eventId: String(event.id || ''),
      status: status,
      ref: String(meta.ref || ''),
      orderNumber: String(meta.orderNumber || ''),
      reference: String(obj.id || ''),
      paymentIntent: String(obj.payment_intent || ''),
      amount: obj.amount_total != null ? Number(obj.amount_total) / 100 : (obj.amount != null ? Number(obj.amount) / 100 : null),
      currency: String(obj.currency || '').toUpperCase(),
    };
  },

  /* { paymentIntent, amount, reason } */
  async refund(opts) {
    const o = opts || {};
    if (!o.paymentIntent) {
      const e = new Error('Refund needs the original payment_intent id.');
      e.status = 422;
      e.code = 'REFUND_NO_INTENT';
      throw e;
    }
    const r = await call('POST', '/v1/refunds', {
      payment_intent: o.paymentIntent,
      amount: o.amount != null ? Math.round(Number(o.amount) * 100) : undefined,
      reason: o.reason === 'duplicate' || o.reason === 'fraudulent' || o.reason === 'requested_by_customer'
        ? o.reason : 'requested_by_customer',
      metadata: { orderNumber: o.orderNumber || '' },
    });
    return {
      ok: true,
      provider: 'stripe',
      reference: String(r.id || ''),
      status: String(r.status || ''),
      amount: r.amount != null ? Number(r.amount) / 100 : o.amount,
    };
  },
};
