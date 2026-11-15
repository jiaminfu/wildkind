/* ============================================================
   LASTGROVE · PayPal 沙盒/正式环境一键校验 + Webhook 注册
   ------------------------------------------------------------
   为什么要有这个脚本：
   PayPal 后台建 Webhook 要在网页里点四五个事件，容易漏勾、
   也容易把 URL 写成 http 或漏掉 /api/v1 前缀。用 API 建更稳：
   事件清单和 URL 都写死在这里，可重复执行、可审计。

   用法（密钥只从环境变量读，绝不写进文件）：
     set -a && . ./.secrets/pp.env && set +a
     node tools/pp-setup.js --check          # 只验证 Client ID / Secret 是否可用
     node tools/pp-setup.js                  # 校验 + 注册 Webhook，打印 WEBHOOK_ID

   环境变量：
     PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET  必填
     PAYPAL_ENV                               sandbox | live，默认 sandbox
     PAYPAL_WEBHOOK_URL                       默认 https://lastgrove.com/api/v1/payments/webhook/paypal

   退出码：0 成功；2 密钥无效；3 Webhook 注册失败；1 其它。
   ============================================================ */
'use strict';
const https = require('https');

const ENV = String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
const HOST = ENV === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
const ID = String(process.env.PAYPAL_CLIENT_ID || '').trim();
const SECRET = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
const HOOK_URL = String(process.env.PAYPAL_WEBHOOK_URL ||
  'https://lastgrove.com/api/v1/payments/webhook/paypal').trim();

/* 与 app/server/lib/payments/paypal.js 的 verifyWebhook 映射表一一对应。
   少订一个事件，那一类状态变化就只能靠买家回跳，回跳丢了钱就卡住。 */
const EVENTS = [
  'CHECKOUT.ORDER.APPROVED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
];

function call(method, path, body, token, extra) {
  return new Promise((resolve, reject) => {
    /* 表单串原样发，对象才序列化（OAuth 端点只收 urlencoded） */
    const data = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    }, token ? { Authorization: 'Bearer ' + token } : {}, extra || {});
    const req = https.request({ hostname: HOST, port: 443, path, method, timeout: 20000, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 空体正常 */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
        const err = new Error((json && (json.error_description || json.message)) || ('HTTP ' + res.statusCode));
        err.status = res.statusCode;
        err.body = json;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out after 20s')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function token() {
  const basic = Buffer.from(ID + ':' + SECRET).toString('base64');
  return call('POST', '/v1/oauth2/token', 'grant_type=client_credentials', null, {
    Authorization: 'Basic ' + basic,
    'Content-Type': 'application/x-www-form-urlencoded',
  });
}

function mask(s) {
  const v = String(s || '');
  return v.length <= 8 ? '****' : v.slice(0, 4) + '…' + v.slice(-4) + '（' + v.length + ' 字符）';
}

(async () => {
  console.log('环境：%s（%s）', ENV, HOST);
  if (!ID || !SECRET) {
    console.error('缺 PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET。先 source 密钥文件。');
    process.exit(1);
  }
  console.log('Client ID：%s', mask(ID));
  console.log('Secret   ：%s', mask(SECRET));

  let t, meta = {};
  /* 注意：token() 返回的是整个 JSON（含 app_id/scope），
     真正要塞进 Authorization 的是 access_token 字符串。 */
  try {
    const r = await token();
    t = String(r.access_token || '');
    if (!t) throw Object.assign(new Error('响应里没有 access_token'), { status: 0 });
    meta = r;
  } catch (e) {
    console.error('\n❌ 认证失败：%s（HTTP %s）', e.message, e.status);
    console.error('   invalid_client 的三种常见原因，按可能性排序：');
    console.error('   1. 密钥抄错/漏字符 —— 用后台的复制按钮，不要手打；');
    console.error('   2. 页面还在 Sandbox 标签，但密钥是 Live 的（或反之）；');
    console.error('   3. App 刚建好还没生效，等 1 分钟再试。');
    process.exit(2);
  }

  console.log('✅ 认证通过，app_id=%s，令牌有效期 %ss', meta.app_id || '(未返回)', meta.expires_in || '?');
  console.log('   权限范围：%s 项', String(meta.scope || '').split(/\s+/).filter(Boolean).length);
  if (!String(meta.scope || '').includes('https://uri.paypal.com/services/applications/webhooks')) {
    console.warn('   ⚠ 令牌里没有 webhooks 权限，后面注册 Webhook 可能失败。');
  }

  if (process.argv.includes('--check')) return;

  console.log('\n目标回调：%s', HOOK_URL);

  const list = await call('GET', '/v1/notifications/webhooks', null, t);
  const hooks = (list && list.webhooks) || [];
  console.log('现有 Webhook：%s 个', hooks.length);
  hooks.forEach(h => console.log('  - %s  %s  %s', h.id, h.url,
    ((h.event_types || []).map(e => e.name).join(',') || '')));

  /* 同一 URL 重复注册会让每个事件投递两次。webhook 侧有 eventId 幂等，
     但重复投递会白跑一遍验签，还在后台留下多条垃圾记录，所以先清同 URL 的旧记录。 */
  const dup = hooks.filter(h => h.url === HOOK_URL);
  for (const h of dup) {
    process.stdout.write('删除同 URL 旧记录 ' + h.id + ' … ');
    await call('DELETE', '/v1/notifications/webhooks/' + encodeURIComponent(h.id), null, t);
    console.log('done');
  }

  let created;
  try {
    created = await call('POST', '/v1/notifications/webhooks', {
      url: HOOK_URL,
      event_types: EVENTS.map(name => ({ name })),
    }, t);
  } catch (e) {
    console.error('\n❌ Webhook 注册失败：%s', e.message);
    console.error(JSON.stringify(e.body || {}, null, 2));
    process.exit(3);
  }

  const names = ((created.event_types) || []).map(e => e.name);
  console.log('✅ 注册成功');
  console.log('   WEBHOOK_ID=%s', created.id);
  console.log('   已订阅 %s 项：', names.length);
  EVENTS.forEach(n => console.log('     %s %s', names.includes(n) ? '✓' : '✗', n));
  console.log('\n把下面这行写进 deploy/.env（不要在聊天里贴回去）：');
  console.log('   PAYPAL_ENV=%s', ENV);
  console.log('   PAYPAL_WEBHOOK_ID=%s', created.id);
})().catch(e => {
  console.error('未预期错误：', e.message);
  process.exit(1);
});
