/* ============================================================
   LASTGROVE · 17TRACK 订阅分类单元测试
   ------------------------------------------------------------
   为什么要用桩而不是打真接口：
   「额度用完」这个分支在免费账户下只能等下个月初才可能复现，
   「单号已注册」要真有一个注册过的单号。这两类都测不了就上线，
   代价是运营把「额度用完」当成「单号无效」，去催客户重报单号。

   这里把 https.request 换掉，直接喂 17TRACK 的响应原文，
   验证 register() 把它分成哪一类。

   用法：node tools/unit-tracking.js
   ============================================================ */
'use strict';

const https = require('https');
const { EventEmitter } = require('events');
const path = require('path');

let lastBody = '';
let queue = [];

/* 最小的 https.request 桩：只实现 tracking.js 用到的那几个方法 */
https.request = function (opts, cb) {
  const req = new EventEmitter();
  req.write = chunk => { lastBody = String(chunk); };
  req.destroy = () => {};
  req.end = () => {
    const reply = queue.shift() || { code: 0, data: {} };
    const res = new EventEmitter();
    res.statusCode = 200;
    process.nextTick(() => {
      cb(res);                                       // 先让调用方挂上监听器
      res.emit('data', Buffer.from(JSON.stringify(reply), 'utf8'));
      res.emit('end');
    });
  };
  return req;
};

process.env.TRACK17_KEY = 'stub-key';

const tracking = require(path.resolve(__dirname, '..', 'app/server/lib/tracking.js'));

const rows = [];
const chk = (name, pass, extra) => rows.push({ 用例: name, 结果: pass ? 'PASS' : 'FAIL', 说明: extra == null ? '' : String(extra) });

const accepts = (number, carrier) => ({
  code: 0,
  data: { accepted: [{ number: number, carrier: carrier || 21051, origin: 3 }], rejected: [] },
});
const rejects = (code, message, number) => ({
  code: 0,
  data: { accepted: [], rejected: [{ number: number || 'X', error: { code: code, message: message } }] },
});

(async () => {
  /* ---------- 1. 正常注册 ---------- */
  queue = [accepts('9400111899223856928499')];
  const r1 = await tracking.register('9400111899223856928499', 'TG1001');
  chk('注册成功返回 ok', r1.ok === true, JSON.stringify(r1));
  chk('带回承运商', !!r1.carrier, r1.carrier);

  /* ---------- 2. 请求体里不能有 lang ----------
     官方计费规则：注册时指定翻译语言，会为「成功的翻译」多扣 1 个额度。
     免费账户每月 100 个，带上 lang 就等于只剩 50 单。
     我们只发美/加/英，承运商轨迹本来就是英文，翻成英文是白花钱。 */
  chk('注册请求体不带 lang', lastBody.indexOf('"lang"') < 0, lastBody);
  chk('注册请求体带 tag（webhook 靠它找订单）',
    lastBody.indexOf('"tag"') >= 0 && lastBody.indexOf('TG1001') >= 0, lastBody);

  /* ---------- 3. 额度用完 ---------- */
  queue = [rejects(-18019908, 'Your quotas have ran out.')];
  const r2 = await tracking.register('9400111899223856928500', 'TG1002');
  chk('额度用完 → quotaExhausted', r2.quotaExhausted === true, JSON.stringify(r2));
  chk('额度用完 ≠ ok', r2.ok === false, r2.ok);
  chk('额度用完保留原错误码', r2.code === -18019908, r2.code);

  /* ---------- 4. 撞当日上限 ---------- */
  queue = [rejects(-18019907, 'Tracking amount exceeds your daily limit.')];
  const r3 = await tracking.register('9400111899223856928501', 'TG1003');
  chk('撞当日上限也归到额度类', r3.quotaExhausted === true, JSON.stringify(r3));

  /* ---------- 5. 已注册过 ----------
     同一单号被两单复用（补发、退换重寄），或上次请求成功但响应丢了。
     当失败处理会给订单盖上「自动追踪不可用」，之后怎么点刷新都修不回来。 */
  queue = [rejects(-18019901, 'Tracking number 9400111899223856928502 is already registered.')];
  const r4 = await tracking.register('9400111899223856928502', 'TG1004');
  chk('已注册过当成功处理', r4.ok === true && r4.already === true, JSON.stringify(r4));

  /* ---------- 6. 单号本身无效（不该被归到额度类）---------- */
  queue = [rejects(-18019903, 'The carrier can not be detected.')];
  const r5 = await tracking.register('NOTATRACKINGNUMBER', 'TG1005');
  chk('单号无效不误判成额度问题', r5.ok === false && !r5.quotaExhausted, JSON.stringify(r5));

  /* ---------- 7. 配额读数 ---------- */
  queue = [{ code: 0, data: { quota_total: 100, quota_used: 13, quota_remain: 87, today_used: 3, max_track_daily: 100 } }];
  const q = await tracking.quota();
  chk('配额读数透传', q.total === 100 && q.used === 13 && q.remain === 87, JSON.stringify(q));

  /* ---------- 输出 ---------- */
  const w = [26, 6];
  const pad = (s, n) => {
    let len = 0;
    for (const ch of String(s)) len += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
    return String(s) + ' '.repeat(Math.max(0, n - len));
  };
  console.log('');
  console.log(pad('用例', w[0]) + pad('结果', w[1]) + '说明');
  console.log('-'.repeat(84));
  rows.forEach(r => console.log(pad(r.用例, w[0]) + pad(r.结果, w[1]) +
    (r.结果 === 'FAIL' ? r.说明 : '').slice(0, 60)));
  const fail = rows.filter(r => r.结果 === 'FAIL').length;
  console.log('-'.repeat(84));
  console.log('  ' + (rows.length - fail) + ' 通过 / ' + fail + ' 失败');
  console.log('');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('测试本身出错：', e);
  process.exit(1);
});
