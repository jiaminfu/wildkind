/* ============================================================
   LASTGROVE · 支付渠道抽象层
   ------------------------------------------------------------
   为什么要有这一层：
   收单通道是整条链路上唯一「随时可能被迫更换」的外部依赖 ——
   大陆主体走 Stripe 要境外公司，走 Airwallex 要营业执照与网站完成度，
   PayPal 风控随时可能冻结。把通道名写死在 checkout 路由里，
   换一次就要动主流程（扣库存、优惠券、赠品、幂等全在这段里），风险极高。
   所以这里只暴露四个动作：建会话、验回调、退款、自检。

   统一约定 —— 每个 provider 导出：
     id               机器名，写进订单 payment.provider
     label            后台展示用
     supports         支持的支付方式（仅供前端渲染按钮）
     isConfigured()   密钥是否齐备（不发起网络请求）
     createSession()  建支付会话，返回 { mode, payment, clientSecret?, url? }
     verifyWebhook()  校验回调签名，返回 { ok, event, orderNumber, status }
     refund()         发起退款

   createSession 的 mode 决定调用方怎么继续：
     'sync'      当场已付，调用方直接落 paid 订单（mock 专用，回归测试走这条）
     'embedded'  返回 clientSecret，前端挂支付组件，等 webhook 确认
     'redirect'  返回 url，整页跳转到托管收银台，等 webhook 确认

   切换通道只改环境变量 PAYMENT_PROVIDER，不动业务代码。
   ============================================================ */
'use strict';

const PROVIDERS = {
  mock: require('./mock'),
  stripe: require('./stripe'),
  airwallex: require('./airwallex'),
  paypal: require('./paypal'),
};

/* 默认 mock。生产环境必须在部署配置里显式指定真实通道，
   绝不能让「没配环境变量」这种情况默默降级成「订单直接算已支付」。 */
function currentId() {
  return String(process.env.PAYMENT_PROVIDER || 'mock').trim().toLowerCase();
}

function getProvider(id) {
  const key = String(id || currentId()).trim().toLowerCase();
  const p = PROVIDERS[key];
  if (!p) {
    const err = new Error('Unknown payment provider: ' + key);
    err.status = 500;
    err.code = 'PAYMENT_PROVIDER_UNKNOWN';
    throw err;
  }
  return p;
}

/* 生产环境自检：mock 通道会把每一单都当成已付款，
   如果带着它上线，等于全站免费。启动时就要拦住。 */
function assertProductionSafe() {
  const id = currentId();
  if (id === 'mock' && process.env.NODE_ENV === 'production') {
    console.error(
      '[payments] 危险：生产环境 PAYMENT_PROVIDER 仍是 mock，' +
      '所有订单会被标记为已支付但实际未收款。请设置 PAYMENT_PROVIDER=stripe|airwallex|paypal。'
    );
  }
  const p = PROVIDERS[id];
  if (p && id !== 'mock' && !p.isConfigured()) {
    console.error('[payments] 通道 %s 已选中但密钥不全，下单会失败。', id);
  }
}

function list() {
  const active = currentId();
  return Object.keys(PROVIDERS).map(k => ({
    id: k,
    label: PROVIDERS[k].label,
    supports: PROVIDERS[k].supports || [],
    configured: PROVIDERS[k].isConfigured(),
    active: k === active,
  }));
}

module.exports = { getProvider, list, currentId, assertProductionSafe, PROVIDERS };
