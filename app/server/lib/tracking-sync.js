/* ============================================================
   LASTGROVE · 物流同步编排
   ------------------------------------------------------------
   把「订阅 + 查询 + 落库 + 审计」串起来。单独一层是为了让
   lib/tracking.js 保持纯净（只管跟 17TRACK 说话，不碰数据库），
   而路由层只管收发请求，不写业务顺序。

   为什么订阅和查询要分开计费理解：
   - register 消耗额度（每个单号一次，之后自动跟踪不再重复计）
   - gettrackinfo 不消耗额度
   所以「同一个单号只订阅一次」这件事必须做对，否则客户每点一次
   刷新就烧掉一个额度。判断依据是 trackingState.registeredFor。
   ============================================================ */
'use strict';

const store = require('./store');
const tracking = require('./tracking');

function audit(action, target, meta) {
  const db = store.get();
  db.auditLog = db.auditLog || [];
  db.auditLog.unshift({
    id: 'A' + Date.now().toString(36),
    at: new Date().toISOString(),
    staffId: null,
    email: 'system:17track',
    action: action,
    target: target || null,
    meta: meta || null,
    ip: null,
  });
  if (db.auditLog.length > 500) db.auditLog.length = 500;
}

function find(number) {
  const db = store.get();
  return db.orders.find(x => String(x.number).toUpperCase() === String(number).toUpperCase());
}

/* 同步一单。返回 { ok, registered, events, status, message }
   永远不抛错：物流同步失败是体验问题，不能把后台保存运单号这个动作搞挂。 */
async function syncOrder(order, opts) {
  const o = order;
  if (!tracking.isConfigured()) return { ok: false, reason: 'not-configured' };
  if (!o || !o.tracking) return { ok: false, reason: 'no-tracking' };

  const number = String(o.tracking).trim();
  const prev = o.trackingState || {};
  const force = !!(opts && opts.force);
  let registered = false;

  if (prev.registeredFor !== number) {
    let reg;
    try {
      reg = await tracking.register(number, o.number);
    } catch (e) {
      /* 网络/额度问题：不写「订阅失败」到订单上，下次还能再试 */
      console.warn('[tracking] 订阅请求异常 order=%s %s', o.number, e.message);
      return { ok: false, reason: 'network', message: e.message };
    }

    const live = find(o.number);
    if (!live) return { ok: false, reason: 'gone' };

    if (!reg.ok) {
      /* 硬失败（比如 USPS 在试用额度下被策略挡住 -18019823）：
         记在订单上，前台如实降级，别让客户对着空轨迹框等。 */
      tracking.applyRegisterError(live, reg);
      audit('tracking.register_failed', live.number, { code: reg.code, message: reg.message });
      store.flush();
      console.warn('[tracking] 订阅被拒 order=%s number=%s code=%s %s',
        live.number, number, reg.code, reg.message);
      return { ok: false, reason: 'register-rejected', message: reg.message, code: reg.code };
    }

    live.trackingState = Object.assign({}, live.trackingState || {}, {
      registeredFor: number,
      registeredAt: new Date().toISOString(),
      provider: reg.carrier ? String(reg.carrier) : (live.trackingState && live.trackingState.provider) || '',
      error: null,
      errorCode: null,
      errorAt: null,
    });
    audit('tracking.registered', live.number, { number: number, origin: reg.origin });
    store.flush();
    registered = true;
  } else if (!force) {
    /* 已订阅且不强制：直接查一次详情就够，省一次写盘 */
  }

  let info;
  try {
    info = await tracking.fetchInfo(number);
  } catch (e) {
    console.warn('[tracking] 查询轨迹异常 order=%s %s', o.number, e.message);
    return { ok: false, registered: registered, reason: 'network', message: e.message };
  }

  const live2 = find(o.number);
  if (!live2) return { ok: false, reason: 'gone' };

  if (!info.ok) {
    /* 刚订阅时没轨迹是正常的（承运商还没扫件），17TRACK 说可能要几分钟。
       这不是错误，标记成「等首扫」，前台显示等待而不是报错。 */
    const st = live2.trackingState || {};
    live2.trackingState = Object.assign({}, st, {
      awaitingFirstScan: true,
      updatedAt: new Date().toISOString(),
    });
    store.flush();
    return { ok: true, registered: registered, events: 0, status: '', awaiting: true };
  }

  const changed = tracking.apply(live2, info);
  if (live2.trackingState) live2.trackingState.awaitingFirstScan = false;
  if (changed) audit('tracking.updated', live2.number, {
    status: info.status, events: info.events.length,
  });
  store.flush();
  return {
    ok: true,
    registered: registered,
    changed: changed,
    events: info.events.length,
    status: info.status,
    label: info.label,
    delivered: info.status === 'Delivered',
  };
}

/* webhook 推送进来时按 tag（订单号）找单；tag 丢了再按单号兜底。
   返回 { order, via } 便于日志里看清是哪条路匹配上的。 */
function resolveOrder(item) {
  const db = store.get();
  const tag = item && item.tag ? String(item.tag).trim() : '';
  if (tag) {
    const byTag = db.orders.find(x => String(x.number).toUpperCase() === tag.toUpperCase());
    if (byTag) return { order: byTag, via: 'tag' };
  }
  const num = item && item.number ? String(item.number).trim() : '';
  if (num) {
    const byNum = db.orders.find(x => String(x.tracking || '').trim() === num);
    if (byNum) return { order: byNum, via: 'number' };
  }
  return { order: null, via: '' };
}

module.exports = { syncOrder, resolveOrder, audit };
