/* ============================================================
   LASTGROVE · 支付回调与通道信息
   ------------------------------------------------------------
   真实通道（Stripe / Airwallex / PayPal）采用「异步确认」：
   下单接口只创建支付会话并返回 clientSecret，订单落 pending_payment；
   钱到底有没有到账，完全由这里收到的 webhook 决定。

   三条硬规则：
   ① 验签必须用原始字节。JSON.parse 之后再 stringify，空格与键序都可能变，
      签名必然对不上 —— 所以 req.rawBody 由 index.js 从 body 的不可枚举属性取出。
   ② 验签失败返回 400，让通道重试；伪造请求永远拿不到 200。
   ③ 事件去重。通道在超时后会重投同一个事件，重复处理会把「已退款」翻回「已支付」。
   ============================================================ */
'use strict';
const crypto = require('crypto');
const store = require('../lib/store');
const pricing = require('../lib/pricing');
const payments = require('../lib/payments');
const { ApiError, E, ok } = require('../lib/http');

/* 支付失败时把订单占用的库存还回去。
   下单那一刻就扣库存是「预留」，防的是两人同时下单超卖；
   但预留必须可撤销，否则一次失败的支付会把这件商品锁死。 */
function releaseStock(d, order) {
  (order.items || []).forEach(l => {
    const p = pricing.findProduct(d, l.productId);
    if (!p) return;
    const v = (p.variants || []).find(x => x.metal === l.variant);
    if (!v) return;

    v.stock += l.qty;
    p.stock = (p.variants || []).reduce((a, x) => a + x.stock, 0);
    if (!l.isGift) p.sold30 = Math.max(0, (p.sold30 || 0) - l.qty);

    d.stockLedger.push({
      id: 'L' + crypto.randomBytes(4).toString('hex'),
      createdAt: new Date().toISOString(),
      sku: v.sku,
      productId: p.id,
      delta: l.qty,
      reason: 'payment_failed_release',
      refType: 'order',
      refId: order.number,
      balanceAfter: v.stock,
    });
  });
}

function routes(router) {
  /* 前端用它决定渲染哪种支付界面：
     sync（mock）直接提交即完成；embedded 挂支付组件；redirect / embed_sdk 交给对应 SDK。 */
  router.get('/api/v1/payments/methods', (req, res) => {
    const active = payments.getProvider();
    ok(res, {
      provider: active.id,
      label: active.label,
      supports: active.supports || [],
      flow: active.isAsync ? 'async' : 'sync',
      configured: active.isConfigured(),
      /* all 里带 configured 标记，后台可以一眼看出「切了通道但密钥没填」 */
      all: payments.list(),
    });
  });

  /* 买家从支付通道回跳后由前端调用：把「已批准」变成「已扣款」。
     没有这一步，PayPal 的钱永远停在「待捕获」，订单也永远停在 pending_payment。

     为什么用 sessionId 而不是订单号：创建支付会话时本地订单还没落库
     （先建会话再落单，见 checkout.js 的注释），所以回跳链接里带不了订单号，
     只能带通道返回的会话 id。这里用它在本地反查订单。 */
  router.post('/api/v1/payments/capture', async (req, res) => {
    const provider = payments.getProvider();

    if (typeof provider.capture !== 'function') {
      throw E.unprocessable('CAPTURE_NOT_REQUIRED',
        'This payment provider does not need a capture step.');
    }

    const sessionId = String((req.body || {}).sessionId || '').trim();
    if (!sessionId) throw E.badRequest('sessionId is required.');

    const db = store.get();
    const order = db.orders.find(o => o.payment && o.payment.reference === sessionId);
    if (!order) throw E.notFound('We could not find an order for this payment session.');

    /* 已经付过了就直接返回。前端回跳和 webhook 会同时触发 capture，
       两边都走到这里时，先到的那条已经把状态改好，后到的不能再改一次。 */
    if (order.status === 'paid') {
      return ok(res, { order, captured: true, already: true });
    }
    if (order.status !== 'pending_payment' && order.status !== 'cancelled') {
      throw E.unprocessable('ORDER_NOT_PAYABLE',
        'This order can no longer be paid (status: ' + order.status + ').');
    }

    const cap = await provider.capture(sessionId);
    if (!cap || !cap.ok) {
      /* 买家取消、卡被拒、余额不足都会走到这里。订单保持 pending_payment，
         不标成 cancelled —— 客户可能换一张卡重试，取消了就再也付不了。 */
      console.warn('[payments] capture 未完成 order=%s status=%s',
        order.number, (cap && cap.status) || '-');
      return ok(res, { order, captured: false, status: (cap && cap.status) || 'unknown' });
    }

    const updated = store.tx(d => {
      const o = d.orders.find(x => x.number === order.number);
      if (!o) return order;
      if (o.status === 'pending_payment' || o.status === 'cancelled') {
        o.status = 'paid';
        o.statusLabel = 'Paid';
        o.paidAt = new Date().toISOString();
      }
      o.payment = Object.assign({}, o.payment, {
        /* 退refund 要用 capture id，不是 PayPal 的 order id —— 两者不通用。
           reference 保留 order id（webhook 靠它反查），capture id 放 intent。 */
        intent: cap.reference || (o.payment && o.payment.intent) || '',
        capturedAt: new Date().toISOString(),
      });
      return o;
    });

    console.log('[payments] capture 成功 order=%s capture=%s', updated.number, cap.reference);
    ok(res, { order: updated, captured: true });
  });

  router.post('/api/v1/payments/webhook/:provider', async (req, res) => {
    const pid = String((req.params && req.params.provider) || '').toLowerCase();
    const provider = payments.getProvider(pid);

    /* 路径里的通道名必须与当前启用的一致。
       否则有人往 /webhook/stripe 打一个假事件，就能绕过「这单走的是哪个通道」的判断。 */
    if (pid !== payments.currentId()) {
      throw E.badRequest('This webhook endpoint is not active for provider "' + pid + '".');
    }

    const raw = req.rawBody || '';
    if (!raw) throw E.badRequest('Empty webhook body.');

    let v;
    try {
      v = await provider.verifyWebhook(raw, req.headers);
    } catch (err) {
      /* 验签过程中的网络错误（PayPal 需要回调其接口验签）不能当成验签失败，
         但也不能放行，所以 502 让通道稍后重试。
         注意必须包成 ApiError：http.js 的 fail() 只认 ApiError，
         光给普通 Error 挂 status 属性，出去还是 500 INTERNAL。 */
      console.error('[payments] webhook 验签异常 provider=%s %s', pid, err.message);
      throw new ApiError(502, 'WEBHOOK_VERIFY_UNAVAILABLE',
        'We could not verify this webhook right now. Please retry.');
    }

    if (!v.ok) {
      console.warn('[payments] webhook 验签未通过 provider=%s reason=%s', pid, v.reason);
      throw E.badRequest('Webhook rejected: ' + (v.reason || 'invalid signature'));
    }

    /* 事件类型我们不关心（比如 customer.created），正常应答但什么都不改 */
    if (!v.status) {
      return ok(res, { received: true, ignored: true, event: v.event });
    }

    const db = store.get();
    const order = db.orders.find(o =>
      (v.ref && o.payRef === v.ref) || (v.orderNumber && o.number === v.orderNumber));

    if (!order) {
      /* 返回 200 而不是 404：通道对 4xx 会持续重投，
         而这单可能压根不是本站发出的（或已被删除）。记日志人工核对即可。 */
      console.warn('[payments] webhook 未匹配到订单 provider=%s ref=%s orderNo=%s',
        pid, v.ref || '-', v.orderNumber || '-');
      return ok(res, { received: true, matched: false });
    }

    const evKey = v.eventId || (v.event + ':' + (v.ref || v.orderNumber));
    if (db.webhookEvents && db.webhookEvents[evKey]) {
      return ok(res, { received: true, duplicate: true, order: order.number });
    }

    /* PayPal 是两段式：买家「批准」只代表他点了同意，钱还没动，
       必须服务端再调一次 capture 才真正扣款。
       放在这里而不是只靠前端回跳，是因为买家批准后直接关掉标签页时，
       return_url 根本不会被访问 —— 只靠前端的话，这单会永远停在
       pending_payment，库存还被占着，而客户以为已经买到了。
       前端如果已经先 capture 过，provider 内部会识别「已捕获」并返回成功，
       重复调用是安全的（见 paypal.js 的 capture 注释）。 */
    if (v.status === 'approved') {
      if (typeof provider.capture !== 'function') {
        return ok(res, { received: true, ignored: true, event: v.event });
      }
      try {
        const cap = await provider.capture(
          v.reference || (order.payment && order.payment.reference) || '');
        if (!cap || !cap.ok) {
          console.warn('[payments] 批准后 capture 未完成 order=%s status=%s',
            order.number, (cap && cap.status) || '-');
          /* 不返回错误：PayPal 对同一事件的重复投递没有意义，
             而且这时候钱大概率还没到，让订单保持 pending_payment 等人工核对，
             比把它标成「已付」或「失败」都更安全。 */
          return ok(res, { received: true, captured: false, order: order.number });
        }
        v.status = 'paid';
        v.paymentIntent = cap.reference || v.paymentIntent;
      } catch (err) {
        console.error('[payments] 批准后 capture 异常 order=%s %s', order.number, err.message);
        /* 同上面的验签异常：必须抛 ApiError，普通 Error 挂 status 属性出去还是 500。
           这里返回 502 是让 PayPal 稍后重投 —— 钱可能已经在扣，不能默默吞掉。 */
        throw new ApiError(502, 'CAPTURE_UNAVAILABLE',
          'We could not complete the capture right now. Please retry.');
      }
    }

    store.tx(d => {
      d.webhookEvents = d.webhookEvents || {};
      d.webhookEvents[evKey] = {
        at: new Date().toISOString(), event: v.event, order: order.number,
      };
      /* 只保留最近 2000 条，避免单文件 JSON 库无限膨胀 */
      const keys = Object.keys(d.webhookEvents);
      if (keys.length > 2000) keys.slice(0, 1000).forEach(k => delete d.webhookEvents[k]);

      const o = d.orders.find(x => x.number === order.number);
      if (!o) return;

      if (v.status === 'paid') {
        /* cancelled 也要接受：用户在失败页刷新后重试支付，成功后回调是迟到的 */
        if (o.status === 'pending_payment' || o.status === 'cancelled') {
          o.status = 'paid';
          o.statusLabel = 'Paid';
          o.paidAt = new Date().toISOString();
        }
        o.payment = Object.assign({}, o.payment, {
          reference: (o.payment && o.payment.reference) || v.reference || '',
          intent: v.paymentIntent || (o.payment && o.payment.intent) || '',
        });

      } else if (v.status === 'failed') {
        if (o.status === 'pending_payment') {
          o.status = 'cancelled';
          o.statusLabel = 'Cancelled';
          o.cancelReason = 'payment_failed';
          releaseStock(d, o);
        }

      } else if (v.status === 'refunded') {
        o.status = 'refunded';
        o.statusLabel = 'Refunded';
        o.refundedAt = new Date().toISOString();
      }
    });

    console.log('[payments] webhook %s provider=%s order=%s → %s',
      v.event, pid, order.number, v.status);

    ok(res, { received: true, order: order.number, status: v.status });
  });
}

module.exports = { routes, releaseStock };
