/* ============================================================
   LASTGROVE · 物流追踪路由
   ------------------------------------------------------------
   ① POST /api/v1/webhooks/tracking          ← 17TRACK 推送（公开，验签）
   ② POST /api/v1/admin/orders/:number/tracking/refresh  ← 手动刷新
   ③ GET  /api/v1/admin/tracking/quota       ← 额度与订阅状况
   ④ GET  /api/v1/admin/tracking/health      ← 配置自检

   回调地址必须与 17TRACK 后台「小包跟踪推送 → URL」逐字一致，
   那边填的是 https://lastgrove.com/api/v1/webhooks/tracking。
   ============================================================ */
'use strict';

const tracking = require('../lib/tracking');
const sync = require('../lib/tracking-sync');
const store = require('../lib/store');
const auth = require('../lib/auth');
const { ApiError, E, ok } = require('../lib/http');

function routes(router) {
  /* ---------------- 公开回调 ---------------- */
  router.post('/api/v1/webhooks/tracking', (req, res) => {
    const raw = req.rawBody || '';
    const sign = req.headers['sign'] || req.headers['x-sign'] || '';

    if (!tracking.isConfigured()) {
      /* 没配密钥时通知对方「别推了」比假装收下更好：
         假装收下会让 17TRACK 认为推送成功，而我们把数据默默丢掉。 */
      throw new ApiError(503, 'TRACKING_NOT_CONFIGURED',
        'Tracking webhook is not configured.');
    }

    if (!tracking.verify(raw, sign)) {
      /* 签名对不上只有两种可能：密钥不一致，或者不是 17TRACK 发的。
         这两种情况重试都没有意义，直接 400 让它停止重投。 */
      console.warn('[tracking] webhook 验签失败 sign=%s len=%d',
        String(sign).slice(0, 12), raw.length);
      throw E.badRequest('Webhook rejected: bad signature.');
    }

    const body = req.body || {};
    const event = body.event || '';
    if (event !== 'TRACKING_UPDATED') {
      /* 目前只订阅了 TRACKING_UPDATED。将来开到 STOPPED 之类的事件时，
         这里要补分支；先 200 应答，避免对方无限重投。 */
      return ok(res, { received: true, ignored: true, event: event });
    }

    const items = (body.data && body.data.accepted) || [];
    let updated = 0;
    let matched = 0;
    const touched = [];

    items.forEach(item => {
      const hit = sync.resolveOrder(item);
      if (!hit.order) {
        /* 找不到订单就 200 掉。这单可能早已被删除，或者是我们在别的
           环境注册的测试号——让它重投一万次也还是找不到。 */
        console.warn('[tracking] 推送未匹配到订单 number=%s tag=%s',
          item.number || '-', item.tag || '-');
        return;
      }
      matched++;
      const info = tracking.normalize(item);
      if (!info) return;
      const changed = tracking.apply(hit.order, info);
      if (changed) {
        const st = hit.order.trackingState || {};
        sync.audit('tracking.updated', hit.order.number, {
          status: st.status, events: st.events.length, via: 'webhook:' + hit.via,
        });
        updated++;
        touched.push({ number: hit.order.number, status: st.status, moved: st.status === 'Delivered' });
      }
    });

    if (matched) store.flush();

    console.log('[tracking] webhook 收到 %d 条，匹配 %d 单，更新 %d 单',
      items.length, matched, updated);

    /* 必须 200：17TRACK 对非 200 会重试 3 次然后放弃这次变更推送。
       全量快照 + apply 里的内容比对，重复投递是安全的。 */
    ok(res, { received: true, items: items.length, matched: matched, updated: updated, orders: touched });
  });

  /* ---------------- 后台：手动刷新 ---------------- */
  /* 客户催「怎么还没动静」时，运营不用等 6 小时一轮的自动跟踪，
     点一下就能立刻拉一次。查询不消耗额度，可以随便点。 */
  router.post('/api/v1/admin/orders/:number/tracking/refresh', async (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:write');
    const db = store.get();
    const o = db.orders.find(x => String(x.number).toUpperCase() === String(req.params.number).toUpperCase());
    if (!o) throw E.notFound('Order not found.');
    if (!o.tracking) throw E.badRequest('This order has no tracking number yet.');

    const out = await sync.syncOrder(o, { force: true });
    ok(res, { order: o, sync: out });
  });

  /* ---------------- 后台：额度与自检 ---------------- */
  router.get('/api/v1/admin/tracking/quota', async (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:read');
    if (!tracking.isConfigured()) {
      return ok(res, { configured: false });
    }
    try {
      const q = await tracking.quota();
      ok(res, { configured: true, quota: q });
    } catch (e) {
      ok(res, { configured: true, error: e.message });
    }
  });

  router.get('/api/v1/admin/tracking/health', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'orders:read');
    const db = store.get();
    const withTracking = db.orders.filter(o => o.tracking);
    ok(res, {
      configured: tracking.isConfigured(),
      ordersWithTracking: withTracking.length,
      subscribed: withTracking.filter(o => o.trackingState && o.trackingState.registeredFor).length,
      failed: withTracking.filter(o => o.trackingState && o.trackingState.error).length,
      delivered: withTracking.filter(o => o.trackingState && o.trackingState.status === 'Delivered').length,
      awaiting: withTracking.filter(o => o.trackingState && o.trackingState.awaitingFirstScan).length,
    });
  });
}

module.exports = { routes };
