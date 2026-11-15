/* ============================================================
   LASTGROVE · 业务事件 → 邮件
   中间这一层的唯一职责是去重。

   为什么需要它：一单「已付款」可能被两处同时触发——
   ① 买家在 PayPal 批准后跳回本站，前端调 /payments/capture（同步路径）
   ② PayPal 同时投 webhook，服务端补一次 capture（异步路径）
   两条路都会把订单标成 paid。如果两处都直接发信，客户会收到两封一模一样的确认信。
   现在 claim() 把标记写在订单对象上，跟着业务状态一起进同一个事务，
   第二个入口看到标记就跳过。邮件服务侧另有 Idempotency-Key 兜底，这是第一道。

   取舍：如果标记写了但发信失败（网关抖动），这封就不会自动重发——
   刻意的。宁可偶发漏发、人工补一封，也不要客户收到三封重复的「付款成功」。
   失败会打 [mail] 发送失败 日志，带订单号，可以照着补。
   ============================================================ */
'use strict';

const mailer = require('./mailer');

function claim(order, field) {
  if (!order) return false;
  order.mail = order.mail || {};
  if (order.mail[field]) return false;
  order.mail[field] = new Date().toISOString();
  return true;
}

function orderConfirmed(order) {
  if (claim(order, 'confirmedAt')) mailer.orderConfirmed(order);
}

function orderShipped(order) {
  /* 没有单号的「已发货」不发：客户点进来查不到任何轨迹，比不收信更困惑 */
  if (!order || !order.tracking) return;
  if (claim(order, 'shippedAt')) mailer.orderShipped(order);
}

function refundIssued(order, amount) {
  if (claim(order, 'refundedAt')) mailer.refundIssued(order, amount);
}

module.exports = { claim, orderConfirmed, orderShipped, refundIssued };
