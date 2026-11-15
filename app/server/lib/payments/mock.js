/* ============================================================
   TIDEGLASS · 模拟支付通道
   ------------------------------------------------------------
   本地开发与自动化回归（accept-zero 207 条 / accept-ui 78 条）全部走这里，
   它返回的 payment 对象必须与「接入真实通道之前」逐字段一致 ——
   一旦字段变化，后台订单页、访客查单页、接口断言会一起失效。

   它不做任何网络请求，也不假装能收钱：mode 固定 'simulated'，
   后台一眼能看出这单没有真实资金流动。
   ============================================================ */
'use strict';
const crypto = require('crypto');

module.exports = {
  id: 'mock',
  label: 'Test gateway (no real charge)',
  supports: ['card'],
  isAsync: false,

  isConfigured() {
    return true;
  },

  /* ctx: { amount, currency, email, last4, meta } */
  async createSession(ctx) {
    const c = ctx || {};
    return {
      mode: 'sync',
      payment: {
        provider: 'mock',
        mode: 'simulated',
        reference: 'sim_' + crypto.randomBytes(6).toString('hex'),
        last4: String(c.last4 || '4242').slice(-4),
      },
    };
  },

  /* mock 没有真实回调。返回 ok:false 而不是抛错，
     这样误配到 mock 的真实发起方会拿到明确原因，而不是 500。 */
  async verifyWebhook() {
    return { ok: false, reason: 'The mock gateway does not emit webhooks.' };
  },

  async refund({ reference, amount, currency }) {
    return {
      ok: true,
      provider: 'mock',
      reference: reference || '',
      amount: amount,
      currency: currency || 'USD',
      status: 'refunded',
      simulated: true,
    };
  },
};
