/* ============================================================
   LASTGROVE · PayPal 通道（骨架，待密钥到位后联调）
   ------------------------------------------------------------
   定位是「兜底 + 转化」而不是主通道：
   - 美国消费者 PayPal 渗透率约两到三成，很多人在看不到 PayPal 按钮时会直接弃单；
   - 费率明显高于卡收单（跨境还要再加一笔），所以大额订单不该默认走它；
   - 新账户突然起量、发货慢、拒付率高都可能触发 180 天资金冻结，
     所以它永远不该是唯一通道。

   ⚠ 与 airwallex.js 一样，本文件按官方 REST 结构写成但**未经真实账号验证**，
     标 [TODO-VERIFY] 处需要联调核对。真正上线前必须用沙盒跑通
     创建订单 → 买家批准 → capture → webhook 四步。

   环境变量：
     PAYPAL_CLIENT_ID
     PAYPAL_CLIENT_SECRET
     PAYPAL_WEBHOOK_ID       后台 Webhook 详情页的 ID，验签必须用它
     PAYPAL_ENV              'sandbox' | 'live'，默认 sandbox
   ============================================================ */
'use strict';
const https = require('https');

function env() {
  return String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
}

function host() {
  return env() === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
}

function creds() {
  return {
    id: String(process.env.PAYPAL_CLIENT_ID || '').trim(),
    secret: String(process.env.PAYPAL_CLIENT_SECRET || '').trim(),
  };
}

function webhookId() {
  return String(process.env.PAYPAL_WEBHOOK_ID || '').trim();
}

let cached = { token: '', exp: 0 };

function call(method, path, body, token, extraHeaders) {
  return new Promise((resolve, reject) => {
    /* 注意：OAuth 端点的 body 是表单串（grant_type=client_credentials），
       不是 JSON。早先这里对所有 body 一律 JSON.stringify，会把表单串包成
       带引号的 JSON 字符串发出去，PayPal 直接回 400 Grant Type is NULL。
       这个坑只有真连上沙盒才会暴露 —— 现在按类型分流：
       字符串原样发（表单），对象才序列化。 */
    const data = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }, token ? { 'Authorization': 'Bearer ' + token } : {}, extraHeaders || {});

    const req = https.request({
      hostname: host(), port: 443, path: path, method: method, timeout: 20000, headers: headers,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 空响应体是正常情况（如 capture 204） */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
        const err = new Error('PayPal: ' +
          ((json && (json.message || (json.details && json.details[0] && json.details[0].description))) ||
            ('HTTP ' + res.statusCode)));
        err.status = 502;
        err.code = 'PAYPAL_ERROR';
        err.detail = json;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('PayPal request timed out after 20s')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function token() {
  if (cached.token && cached.exp > Date.now() + 60 * 1000) return cached.token;
  const c = creds();
  const basic = Buffer.from(c.id + ':' + c.secret).toString('base64');
  const r = await call('POST', '/v1/oauth2/token',
    'grant_type=client_credentials', null,
    { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' });
  const t = String(r.access_token || '');
  if (!t) throw Object.assign(new Error('PayPal returned no access token.'), { status: 502 });
  cached = { token: t, exp: Date.now() + Math.max(60, Number(r.expires_in || 3000) - 120) * 1000 };
  return t;
}

module.exports = {
  id: 'paypal',
  label: 'PayPal',
  supports: ['paypal', 'card'],
  isAsync: true,

  isConfigured() {
    const c = creds();
    return !!(c.id && c.secret && webhookId());
  },

  isLive() {
    return env() === 'live';
  },

  /* ctx: { orderNumber, amount, currency, email, description, returnUrl, cancelUrl, meta } */
  async createSession(ctx) {
    const c = ctx || {};
    const amount = Number(c.amount || 0);
    if (!(amount > 0)) {
      throw Object.assign(new Error('Order total must be greater than zero.'),
        { status: 422, code: 'AMOUNT_INVALID' });
    }

    const t = await token();
    const base = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');

    /* [TODO-VERIFY] PayPal 的金额是字符串且必须两位小数，币种用大写三字母码 */
    const r = await call('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(c.ref || c.orderNumber || ''),
        custom_id: String(c.ref || c.orderNumber || ''),
        description: String(c.description || 'LASTGROVE order').slice(0, 127),
        amount: {
          currency_code: String(c.currency || 'USD').toUpperCase(),
          value: amount.toFixed(2),
        },
      }],
      application_context: {
        brand_name: 'LASTGROVE',
        shipping_preference: 'NO_SHIPPING',   // 运费地址在自家结算页收，避免在 PayPal 里再填一遍
        user_action: 'PAY_NOW',
        return_url: c.returnUrl || (base + '/#/order/confirm'),
        cancel_url: c.cancelUrl || (base + '/#/checkout'),
      },
    }, t);

    const approve = (r.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action');

    return {
      /* 前端可以用 PayPal JS SDK 直接渲染按钮（推荐，转化更好）：
            paypal.Buttons({ createOrder: () => '<后端返回的 orderId>' })
         这里把 orderId 和跳转链接都给出去，两种接法都能用。 */
      mode: 'embed_sdk',
      payment: {
        provider: 'paypal',
        mode: this.isLive() ? 'live' : 'sandbox',
        reference: String(r.id || ''),
        last4: '',
      },
      sessionId: String(r.id || ''),
      approveUrl: approve ? approve.href : '',
    };
  },

  /* 买家在 PayPal 侧批准后，必须由服务端调用 capture 才真正扣款。
     这一步不能交给前端「点完就算付了」。

     为什么要做幂等：同一个订单会有两条路径同时来 capture ——
       ① 买家从 PayPal 回跳，前端调 /payments/capture；
       ② PayPal 的 CHECKOUT.ORDER.APPROVED 回调，webhook 里补一次。
     两条路径可能前后脚到达，第二次会拿到 ORDER_ALREADY_CAPTURED 的 422。
     那其实说明「钱已经收到了」，属于成功，不能当失败处理，
     否则订单会一直挂在 pending_payment，而钱早已进账。 */
  async capture(orderId) {
    const t = await token();
    let r;
    try {
      r = await call('POST', '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {}, t);
    } catch (err) {
      const name = String((err.detail && err.detail.name) || '');
      const issue = String((err.detail && err.detail.details && err.detail.details[0] &&
        err.detail.details[0].issue) || '');
      if (name === 'ORDER_ALREADY_CAPTURED' || issue === 'ORDER_ALREADY_CAPTURED') {
        r = await call('GET', '/v2/checkout/orders/' + encodeURIComponent(orderId), null, t);
      } else if (issue === 'ORDER_NOT_APPROVED' || name === 'ORDER_NOT_APPROVED' ||
                 issue === 'PAYER_ACTION_REQUIRED') {
        /* 买家在 PayPal 页面点了取消，或根本没点「同意」就关掉了。
           这是正常业务分支，不是服务端故障 —— 返回 ok:false 让上层
           显示「没有扣款、订单还留着可以重试」，而不是抛 502 吓人。 */
        return { ok: false, status: 'NOT_APPROVED', reference: '', amount: null, currency: '', orderNumber: '' };
      } else {
        throw err;
      }
    }
    const unit = (r.purchase_units || [])[0] || {};
    const cap = (unit.payments && unit.payments.captures && unit.payments.captures[0]) || {};
    return {
      ok: String(r.status || '') === 'COMPLETED' || String(cap.status || '') === 'COMPLETED',
      status: String(r.status || '').toUpperCase() === 'COMPLETED'
        ? 'COMPLETED'
        : String(cap.status || r.status || ''),
      reference: String(cap.id || r.id || ''),
      amount: cap.amount ? Number(cap.amount.value) : null,
      currency: cap.amount ? String(cap.amount.currency_code || '').toUpperCase() : '',
      orderNumber: String(unit.custom_id || unit.reference_id || ''),
    };
  },

  /* PayPal 的验签是「把回调原样回传给 PayPal 让它自己验」，
     和我们自己算 HMAC 不同，因此必须拿到完整 headers。 */
  async verifyWebhook(rawBody, headers) {
    const h = headers || {};
    const id = webhookId();
    if (!id) return { ok: false, reason: 'PAYPAL_WEBHOOK_ID is not set.' };

    let event = null;
    try { event = JSON.parse(rawBody); }
    catch (e) { return { ok: false, reason: 'Body is not valid JSON.' }; }

    const t = await token();
    let v;
    try {
      v = await call('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h['paypal-auth-algo'] || '',
        cert_url: h['paypal-cert-url'] || '',
        transmission_id: h['paypal-transmission-id'] || '',
        transmission_sig: h['paypal-transmission-sig'] || '',
        transmission_time: h['paypal-transmission-time'] || '',
        webhook_id: id,
        webhook_event: event,
      }, t);
    } catch (err) {
      /* 缺头/头被改过时 PayPal 回 INVALID_REQUEST（400），这不是「PayPal 挂了」，
         而是「这条请求不是 PayPal 发的」—— 按验签失败处理，返回 400 让对方别再重投。
         真正的网络异常（超时、5xx）继续往上抛，由路由转成 502 让 PayPal 稍后重试。 */
      const n = String((err.detail && err.detail.name) || '');
      if (n === 'INVALID_REQUEST' || n === 'VALIDATION_ERROR') {
        return { ok: false, reason: 'Signature headers are missing or malformed.' };
      }
      throw err;
    }

    if (String(v.verification_status || '') !== 'SUCCESS') {
      return { ok: false, reason: 'PayPal rejected the signature.' };
    }

    const type = String(event.event_type || '');
    const res = (event.resource) || {};
    const map = {
      'PAYMENT.CAPTURE.COMPLETED': 'paid',
      'PAYMENT.CAPTURE.DENIED': 'failed',
      'PAYMENT.CAPTURE.REFUNDED': 'refunded',
      /* 批准 ≠ 付款。PayPal 的两段式流程里，这一步只是买家点了「同意」，
         钱还没动，必须服务端再 capture 一次。这里给一个独立状态，
         让 webhook 路由去补 capture —— 买家批准完直接关掉页面时，
         回跳根本不会发生，只靠前端确认的话这单就永远收不到钱。 */
      'CHECKOUT.ORDER.APPROVED': 'approved',
    };

    return {
      ok: true,
      event: type,
      eventId: String(event.id || ''),
      status: Object.prototype.hasOwnProperty.call(map, type) ? map[type] : null,
      ref: String(res.custom_id || ((res.purchase_units && res.purchase_units[0] &&
        (res.purchase_units[0].custom_id || res.purchase_units[0].reference_id)) || '')),
      orderNumber: '',
      reference: String(res.id || ''),
      paymentIntent: String(res.id || ''),
      amount: res.amount ? Number(res.amount.value) : null,
      currency: res.amount ? String(res.amount.currency_code || '').toUpperCase() : '',
    };
  },

  async refund(opts) {
    const o = opts || {};
    if (!o.paymentIntent) {
      throw Object.assign(new Error('Refund needs the original capture id.'),
        { status: 422, code: 'REFUND_NO_CAPTURE' });
    }
    const t = await token();
    const body = {};
    if (o.amount != null) {
      body.amount = { value: Number(o.amount).toFixed(2), currency_code: String(o.currency || 'USD').toUpperCase() };
    }
    const r = await call('POST', '/v2/payments/captures/' + encodeURIComponent(o.paymentIntent) + '/refund', body, t);
    return {
      ok: true,
      provider: 'paypal',
      reference: String(r.id || ''),
      status: String(r.status || ''),
      amount: r.amount ? Number(r.amount.value) : o.amount,
    };
  },
};
