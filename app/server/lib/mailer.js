/* ============================================================
   LASTGROVE · 事务邮件发送
   通道：Resend（https://resend.com），零依赖，直接打 HTTPS API。

   三条硬约束，都写进实现里：
   1) 发信失败绝不能影响业务。钱已经收了、货已经发了，
      邮件发不出去是体验问题，不是交易问题。所以一律 fire-and-forget，
      失败只记日志 + 重试，不向上抛。
   2) 必须幂等。同一个业务事件可能从同步接口和 webhook 两个入口
      各触发一次（PayPal 批准后回跳 + webhook 补 capture 都会把单标成 paid），
      靠 Idempotency-Key 让 Resend 侧去重，不会给客户发两封一样的信。
   3) 没有 key 也要能验证。MAIL_DRY_RUN=1 时把整封信打到日志，
      这样在拿到 key 之前就能确认触发时机对不对，而不是等上线才发现漏发。
   ============================================================ */
'use strict';

const https = require('https');
const T = require('./mail-templates');

const HOST = 'api.resend.com';
const PATH = '/emails';
const TIMEOUT = 15000;

function conf() {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  return {
    key,
    from: String(process.env.MAIL_FROM || 'LASTGROVE <hello@lastgrove.com>').trim(),
    replyTo: String(process.env.MAIL_REPLY_TO || '').trim(),
    site: String(process.env.PUBLIC_URL || 'https://lastgrove.com').replace(/\/+$/, ''),
    dry: !key || String(process.env.MAIL_DRY_RUN || '') === '1',
  };
}

/* 有没有配好。启动时打一行日志，避免「以为在发信，其实一直在 dry-run」。 */
function isConfigured() {
  return !!conf().key && String(process.env.MAIL_DRY_RUN || '') !== '1';
}

function statusLine() {
  const c = conf();
  if (!c.key) return 'dry-run（未配置 RESEND_API_KEY）';
  if (String(process.env.MAIL_DRY_RUN || '') === '1') return 'dry-run（MAIL_DRY_RUN=1）';
  return c.from;
}

function post(payload, idemKey) {
  const c = conf();
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const headers = {
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'LASTGROVE-mailer/1.0',
    };
    /* Resend 的幂等窗口是 24 小时，key 最长 256 字符 */
    if (idemKey) headers['Idempotency-Key'] = String(idemKey).slice(0, 256);

    const req = https.request({ hostname: HOST, path: PATH, method: 'POST', headers, timeout: TIMEOUT }, r => {
      const chunks = [];
      r.on('data', d => chunks.push(d));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let js = null;
        try { js = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ }
        if (r.statusCode >= 200 && r.statusCode < 300) {
          resolve({ id: (js && js.id) || '', status: r.statusCode });
          return;
        }
        const msg = String((js && (js.message || js.error)) || text || '').slice(0, 200);
        reject(Object.assign(new Error('Resend HTTP ' + r.statusCode + ' ' + msg), { status: r.statusCode }));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Resend timeout ' + TIMEOUT + 'ms')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function send(mail, idemKey) {
  const c = conf();
  const payload = {
    from: c.from,
    to: Array.isArray(mail.to) ? mail.to : [String(mail.to || '')].filter(Boolean),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  };
  if (!payload.to.length) throw new Error('收件人为空');
  if (c.replyTo) payload.reply_to = c.replyTo;

  if (c.dry) {
    console.log('[mail] DRY-RUN 未发送 → %s | %s | idem=%s\n%s\n---',
      payload.to.join(','), payload.subject, idemKey || '-',
      String(mail.text || '').slice(0, 900));
    return { dry: true, id: '' };
  }

  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      return await post(payload, idemKey);
    } catch (err) {
      last = err;
      /* 4xx（除 429 限流）是配置或参数错——key 错、域名没验证、收件人非法。
         重试三次只是把同一个错误打三遍，直接放弃并让它进日志。 */
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) break;
      await sleep(300 * Math.pow(3, i));
    }
  }
  throw last || new Error('发送失败');
}

/* 业务侧只调这三个。全部异步，不阻塞响应。 */
function deliver(kind, mail, idemKey) {
  setImmediate(() => {
    send(mail, idemKey)
      .then(r => {
        if (r.dry) return;
        console.log('[mail] 已发送 kind=%s to=%s id=%s', kind, mail.to, r.id);
      })
      .catch(e => {
        /* 发不出去不能让订单失败，但必须在日志里留下痕迹，便于人工补发 */
        console.error('[mail] 发送失败 kind=%s to=%s %s', kind, mail.to, e.message);
      });
  });
}

function orderConfirmed(order) {
  if (!order || !order.email) return;
  deliver('order.confirmed', Object.assign({ to: order.email }, T.confirmed(order, conf())),
    'lg-confirm-' + order.number);
}

function orderShipped(order) {
  if (!order || !order.email) return;
  if (!order.tracking) return;   /* 没有单号就不发「已发货」，否则客户点进去查不到 */
  deliver('order.shipped', Object.assign({ to: order.email }, T.shipped(order, conf())),
    'lg-ship-' + order.number + '-' + order.tracking);
}

function refundIssued(order, amount) {
  if (!order || !order.email) return;
  deliver('order.refunded', Object.assign({ to: order.email },
    T.refunded(order, Object.assign({ amount }, conf()))),
    'lg-refund-' + order.number + '-' + Math.round((Number(amount) || 0) * 100));
}

/* 单测/自检用：把渲染结果直接返回，不发信 */
function preview(kind, order, extra) {
  const c = conf();
  const map = {
    confirmed: () => T.confirmed(order, c),
    shipped: () => T.shipped(order, c),
    refunded: () => T.refunded(order, Object.assign({ amount: (extra || {}).amount }, c)),
  };
  const fn = map[kind];
  if (!fn) throw new Error('未知邮件类型 ' + kind);
  return fn();
}

module.exports = {
  isConfigured, statusLine, send, preview,
  orderConfirmed, orderShipped, refundIssued,
};
