/* ============================================================
   LASTGROVE · 17TRACK 物流追踪
   ------------------------------------------------------------
   为什么是 17TRACK：单价 ¥0.03/单（¥299 / 10,000 单），
   3,600+ 承运商，中国主体可签约开票，并且是 webhook 推送
   而不是我们自己轮询——状态变了才回调，不漏事件也不白烧额度。
   （AfterShip 的 API 要到 Pro 档，$119/月起，小站用不起。）

   两条链路：
   ① 出站：后台存运单号 → register() 把单号订阅到 17TRACK
   ② 入站：17TRACK 状态变化 → POST /api/v1/webhooks/tracking
            → 验签 → 按 tag(订单号) 找回订单 → 落 trackingState

   三个刻意的取舍：
   - 不传 carrier 给 register，让 17TRACK 自己识别（官方称 80%+ 可自动识别）。
     我们自己那张承运商表（USPS/UPS/FedEx/…）和 17TRACK 的数字代码不是一回事，
     猜错一个数字码等于把一个好单号订阅成一个查不到的结果。
   - register 有失败的可能（USPS 在试用额度下直接被策略挡住，
     报 -18019823），失败必须被记下来并在前台如实降级成「去承运商官网查」，
     不能让客户对着一个永远空着的轨迹框。
   - 拒绝在内网/前端调用：密钥只存在服务端环境变量里。

   关于额度（免费账户每月 100 个，月底清零、不累积，官方计费规则原文）：
   - 只有 register 扣额度。订阅成功之后，重复查询、自动追踪、webhook 推送
     都不再扣。所以「注册一次、随便查」是把免费额度用足的正确姿势，
     代码里用 trackingState.registeredFor 记住订过哪个单号，避免重复注册。
   - 传 lang 会让注册变成 2 个额度（registration + translation）。
     我们只发美/加/英，承运商轨迹本来就是英文，翻成英文是白扔一半额度，
     所以注册时不传 lang。这条别改回去。
   - 同一单号注册到不同承运商各扣 1。所以别乱传 carrier。
   ============================================================ */
'use strict';

const crypto = require('crypto');
const https = require('https');

const BASE = 'https://api.17track.net/track/v2.4';

/* 只留最近 20 条事件进订单对象。db.json 是全量落盘的，
   一个包裹动辄 30+ 条事件，几百单叠起来会把文件撑到几 MB，
   而客户真正会看的就是最近几条。完整轨迹点「在承运商官网查看」。 */
const MAX_EVENTS = 20;

/* 17TRACK 的 9 个主状态。这里做两件事：翻成人话，以及给出进度条位置。 */
const STATUS = {
  NotFound: { label: 'Awaiting carrier scan', stage: 0 },
  InfoReceived: { label: 'Label created', stage: 1 },
  InTransit: { label: 'In transit', stage: 2 },
  Expired: { label: 'Tracking expired', stage: 2 },
  AvailableForPickup: { label: 'Ready for pickup', stage: 3 },
  OutForDelivery: { label: 'Out for delivery', stage: 3 },
  Delivered: { label: 'Delivered', stage: 4 },
  Exception: { label: 'Delayed', stage: 2 },
  Undelivered: { label: 'Delivery failed', stage: 3 },
};

function key() {
  return String(process.env.TRACK17_KEY || '').trim();
}

function isConfigured() {
  return key().length > 0;
}

/* ---------------- HTTP ---------------- */
function call(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload == null ? [] : payload);
    const req = https.request({
      hostname: 'api.17track.net',
      path: '/track/v2.4' + path,
      method: 'POST',
      timeout: 15000,
      headers: {
        '17token': key(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
        if (res.statusCode === 429) {
          return reject(new Error('17TRACK 频率超限（3 req/s），稍后重试'));
        }
        if (!json) {
          return reject(new Error('17TRACK 返回非 JSON（HTTP ' + res.statusCode + '）'));
        }
        if (json.code !== 0) {
          return reject(new Error('17TRACK 错误 code=' + json.code + ' ' +
            (json.message || JSON.stringify(json.data || {}).slice(0, 200))));
        }
        resolve(json.data || {});
      });
    });
    req.on('timeout', () => req.destroy(new Error('17TRACK 请求超时 15s')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ---------------- 出站：订阅单号 ---------------- */
/* tag 用订单号：webhook 推回来时凭它找订单。
   单号本身也能匹配，但客户改单号（输错重输）后 tag 仍指向原订单，更稳。 */
/* 额度耗尽的错误码。官方文档：-18019908 = Your quotas have ran out.
   -18019907 是「超过当日上限」。两者都不是单号的问题，不能记到单号头上。 */
const QUOTA_CODES = [-18019908, -18019907];

async function register(number, tag) {
  /* 刻意不传 lang。
     官方计费规则原文：register 时指定翻译语言，会为「成功的翻译」额外扣 1 个额度
     （registration + translation = 2）。免费账每月只有 100 个额度，
     传 lang 等于把 100 单砍成 50 单。
     而我们只发美/加/英，USPS、UPS、FedEx 的轨迹本来就是英文，
     传 lang:'en' 是花钱把英文翻成英文。 */
  const data = await call('/register', [{
    number: String(number),
    tag: tag ? String(tag) : undefined,
  }]);
  const okList = data.accepted || [];
  const badList = data.rejected || [];

  if (okList.length) {
    const a = okList[0];
    return {
      ok: true,
      carrier: a.carrier || null,
      /* origin: 1=系统纠正过, 2=我们传的承运商对, 3=系统猜的（可能不准） */
      origin: a.origin || null,
      number: a.number,
    };
  }

  const err = (badList[0] && badList[0].error) || {};

  /* -18019901「这个单号已经注册过了」不是失败。
     实际会发生：同一个单号被两单复用（补发、退换重寄）、
     或者我们之前那次请求其实成功了但响应丢了。当成失败处理会给订单
     盖上「自动追踪不可用」，而后台再点刷新也永远修不回来。
     按成功算，直接进查询。 */
  const already = err.code === -18019901 || /has been registered/i.test(err.message || '');
  if (already) {
    return {
      ok: true,
      already: true,
      number: String(number),
      carrier: (badList[0] && badList[0].carrier) || null,
      origin: null,
    };
  }

  /* 额度用完 / 撞当日上限：这跟单号本身没关系，是账户没量了。
     单独标出来，否则订单上会显示成「订阅失败」，运营会去找客户重报单号，
     而真正该做的是等下月 1 号重置或去买套餐。 */
  if (QUOTA_CODES.indexOf(err.code) >= 0) {
    return {
      ok: false,
      quotaExhausted: true,
      number: String(number),
      code: err.code,
      message: err.message || 'Tracking quota exhausted.',
    };
  }

  return {
    ok: false,
    number: String(number),
    code: err.code || null,
    message: err.message || 'Registration rejected by 17TRACK.',
    carrier: (badList[0] && badList[0].carrier) || null,
  };
}

/* ---------------- 入站：查一次轨迹 ---------------- */
/* 查详情不消耗额度（只有 register 计费），所以随时可以手动刷新。 */
async function fetchInfo(number, carrier) {
  const item = { number: String(number) };
  if (carrier) item.carrier = carrier;
  const data = await call('/gettrackinfo', [item]);

  const okList = data.accepted || [];
  if (!okList.length) {
    const err = ((data.rejected || [])[0] || {}).error || {};
    return {
      ok: false,
      code: err.code || null,
      message: err.message || 'No tracking information returned.',
    };
  }
  const info = normalize(okList[0]);
  if (!info) return { ok: false, code: null, message: 'No tracking information yet.' };
  return Object.assign({ ok: true }, info);
}

/* 把 17TRACK 的原始结构压成我们自己的形状。
   原始结构是 providers[] 套 events[]，一个单号可能有多个承运商接力，
   直接扔给前端会让渲染逻辑跟着第三方字段名跑。 */
function normalize(entry) {
  const ti = entry && entry.track_info;
  if (!ti) return null;

  const latest = ti.latest_status || {};
  const providers = (ti.tracking && ti.tracking.providers) || [];

  /* 多承运商接力的单（比如 DHL 到国内转邮政），事件分散在各自的数组里，
     按时间合并后统一倒序，客户看到的是「一条时间线」而不是两张表。 */
  const all = [];
  providers.forEach(p => {
    (p.events || []).forEach(e => {
      all.push({
        at: e.time_utc || e.time_iso || null,
        text: (e.description_translation && e.description_translation.description) || e.description || '',
        place: e.location || '',
        stage: e.sub_status || e.stage || '',
      });
    });
  });

  /* 去重：同一事件在不同 provider 下重复出现是常态 */
  const seen = Object.create(null);
  const events = all
    .filter(e => {
      if (!e.at) return false;
      const k = e.at + '|' + e.text;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_EVENTS);

  const st = STATUS[latest.status] || { label: latest.status || 'In transit', stage: 2 };
  const prov = (providers[0] && providers[0].provider) || {};

  return {
    status: latest.status || '',
    subStatus: latest.sub_status || '',
    label: st.label,
    stage: st.stage,
    provider: prov.name || '',
    eventCount: all.length,
    lastEventAt: events.length ? events[0].at : (ti.latest_event && ti.latest_event.time_utc) || null,
    deliveredAt: latest.status === 'Delivered'
      ? ((ti.latest_event && ti.latest_event.time_utc) || new Date().toISOString())
      : null,
    events: events,
  };
}

/* ---------------- 验签 ----------------
   17TRACK 把签名放在推送请求头 sign 里，算法是：
       SHA256( 原始报文 + "/" + SecurityKey )  的十六进制小写
   必须用原始字节，不能 JSON.parse 之后再 stringify —— 键序、空格、
   转义任何一处不同，算出来的哈希就完全变样，等于把自己的回调全部拒掉。
   （http.js 的 withRaw 已经把原始串留在 req.body.__raw 上。） */
function verify(rawBody, signHeader) {
  const k = key();
  const got = String(signHeader || '').trim().toLowerCase();
  if (!k || !got || !rawBody) return false;

  const expect = crypto.createHash('sha256')
    .update(String(rawBody) + '/' + k, 'utf8')
    .digest('hex');

  /* 长度不等时 timingSafeEqual 会抛错，先挡一道 */
  if (got.length !== expect.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expect, 'utf8'));
  } catch (e) {
    return false;
  }
}

/* ---------------- 落到订单上 ---------------- */
/* 幂等：webhook 会重投，手动刷新也会走这里。
   同样的状态回来第二次，除了 updatedAt 之外什么都不该变。 */
function apply(order, info) {
  if (!order || !info) return false;
  const prev = order.trackingState || {};

  const delivered = info.status === 'Delivered';
  const next = {
    status: info.status,
    subStatus: info.subStatus,
    label: info.label,
    stage: info.stage,
    provider: info.provider || prev.provider || '',
    events: info.events || [],
    eventCount: info.eventCount || 0,
    lastEventAt: info.lastEventAt || null,
    deliveredAt: delivered ? (info.deliveredAt || prev.deliveredAt || new Date().toISOString()) : (prev.deliveredAt || null),
    registeredFor: prev.registeredFor || null,
    registeredAt: prev.registeredAt || null,
    error: null,
    errorAt: null,
    updatedAt: new Date().toISOString(),
  };

  order.trackingState = next;

  /* 送达即完成：fulfilled → completed 是后台本来就要点的最后一步，
     承运商已经确认签收了，没有理由再让人手工点一次。
     只在 fulfilled 时推进，已退款/已取消的单绝不能被物流状态改回来。 */
  if (delivered && order.status === 'fulfilled') {
    order.status = 'completed';
    order.statusLabel = 'Delivered';
    order.completedAt = next.deliveredAt || new Date().toISOString();
  }

  /* 「有没有变化」只比内容，不比 updatedAt。
     拿整块对象比的话每次都不一样（updatedAt 每次都新），
     webhook 重投就会报 updated:1，日志里再也看不出真实变更。 */
  const sig = s => JSON.stringify([
    s.status, s.subStatus, s.label, s.provider, s.deliveredAt,
    s.error || '', s.events || [],
  ]);
  return sig(next) !== sig(prev);
}

/* 记下注册失败，前台据此如实降级，而不是留一个永远空着的轨迹框 */
function applyRegisterError(order, res) {
  if (!order) return;
  const prev = order.trackingState || {};
  order.trackingState = {
    status: '',
    label: '',
    stage: 0,
    provider: prev.provider || '',
    events: [],
    eventCount: 0,
    lastEventAt: null,
    deliveredAt: prev.deliveredAt || null,
    registeredFor: null,
    registeredAt: null,
    error: res.message || 'Tracking subscription failed.',
    errorCode: res.code || null,
    errorAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/* 额度自检：register 是计费的，运营需要能在后台看到还剩多少。
   quota_total 是「还剩多少可订阅的单号数」，用完就订不进去了。 */
async function quota() {
  const d = await call('/getquota', []);
  return {
    total: d.quota_total || 0,
    used: d.quota_used || 0,
    remain: d.quota_remain || 0,
    todayUsed: d.today_used || 0,
    maxDaily: d.max_track_daily || 0,
  };
}

module.exports = {
  isConfigured,
  quota,
  register,
  fetchInfo,
  normalize,
  verify,
  apply,
  applyRegisterError,
  STATUS,
  MAX_EVENTS,
};
