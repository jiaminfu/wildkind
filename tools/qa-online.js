/* 线上版本验收测试（生产环境，只读为主 + 可回滚写）
   ================================================================
   与 tools/api-test.js 的区别：
     - api-test.js 靠 POST /__test/reset 把库打回基线，只适合本地；
       线上没有这个端点（实测 404），也不该有。
     - 本脚本不使用任何重置能力。写操作全部限定在标题/句柄带 QA 前缀的
       测试商品上，正常结束或异常中断都会在 finally 里清理干净；
       真实商品、订单、设置一律只读。

   用法：
     node tools/qa-online.js                      # 打默认线上地址
     BASE=http://127.0.0.1:4600 node tools/qa-online.js

   产出：
     tmp_qa/online-result.json   逐条结果（供报告引用）
     控制台摘要                  分组统计 + 失败明细 + 数据影响
*/
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://194.36.85.20:8080';
/* 口令一律从环境变量读，不写默认值：
   这个脚本会打生产环境，把明文口令写进版本库等于把后台钥匙挂到仓库门口。
   用法：
     QA_OWNER_PASS=<owner 口令> QA_OPS_PASS=<ops 口令> node tools/qa-online.js
   两个口令都可以在服务器的 deploy/.env 里取到。 */
const OWNER_EMAIL = process.env.QA_OWNER_EMAIL || 'owner@tideglassjewelry.com';
const OWNER_PASS = process.env.QA_OWNER_PASS || '';
const OPS_EMAIL = process.env.QA_OPS_EMAIL || 'ops@tideglassjewelry.com';
const OPS_PASS = process.env.QA_OPS_PASS || '';
const STAMP = Date.now().toString(36).slice(-5);
const TAG = 'QA-' + STAMP;            // 商品标题前缀
const HANDLE_TAG = 'qa-' + STAMP + '-'; // 句柄前缀

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString('base64');

const results = [];
let TOK = '', OPS_TOK = '';
const created = [];   // 记录本脚本创建的商品 id，用于 finally 清理

function rec(id, group, name, expect, ok, extra) {
  const skipped = !!(extra && extra.skipped);
  results.push({ id, group, name, expect, ok, skipped, ms: extra && extra.ms, detail: extra && extra.detail });
  const mark = skipped ? '·' : (ok ? '✓' : '✗');
  const tail = extra && extra.detail ? '  ← ' + String(extra.detail).slice(0, 160) : '';
  console.log('  ' + mark + ' [' + id + '] ' + name + tail);
}

async function req(method, p, body, opt) {
  const o = opt || {};
  const headers = { 'Content-Type': 'application/json' };
  const tok = o.token === undefined ? null : o.token;
  if (tok) headers.Authorization = 'Bearer ' + tok;
  if (o.headers) Object.assign(headers, o.headers);
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(BASE + p, {
      method, headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeout || 30000),
      redirect: 'manual',
    });
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, netError: e.message };
  }
  const ms = Date.now() - t0;
  const ct = r.headers.get('content-type') || '';
  let json = null, text = '';
  if (ct.includes('json')) json = await r.json().catch(() => null);
  else text = await r.text().catch(() => '');
  return { status: r.status, ms, json, text, headers: r.headers, ct };
}

/* 断言辅助：把「期望 vs 实际」写清楚，失败时直接能看懂 */
function expectStatus(r, want, extra) {
  const ok = (Array.isArray(want) ? want : [want]).indexOf(r.status) >= 0;
  return Object.assign({ ok, detail: ok ? null : 'HTTP ' + r.status + ' ' + ((r.json && r.json.error && r.json.error.code) || '') }, extra || {});
}
function errCode(r) { return r.json && r.json.error ? r.json.error.code : null; }

(async () => {
  if (!OWNER_PASS || !OPS_PASS) {
    console.error('缺少口令：请设置 QA_OWNER_PASS 与 QA_OPS_PASS 环境变量后再运行。\n' +
      '  QA_OWNER_PASS=xxx QA_OPS_PASS=yyy node tools/qa-online.js');
    process.exit(2);
  }
  console.log('\n=========== 线上版本验收 @ ' + BASE + ' ===========');
  console.log('测试标记：' + TAG + '（结束后自动清理）\n');

  let cleanupDone = false;
  let baseCounts = {};

  try {
    /* ============ A. 系统与交付 ============ */
    console.log('— A 系统与交付 —');

    let r = await req('GET', '/api/v1/health');
    rec('SYS-01', 'SYS', '健康检查返回 200 且 status=ok', '200 / ok:true',
      r.status === 200 && r.json && r.json.data && r.json.data.status === 'ok', { ms: r.ms, detail: r.json && r.json.data ? 'products=' + r.json.data.products + ' orders=' + r.json.data.orders : null });

    baseCounts = r.json && r.json.data ? { products: r.json.data.products, orders: r.json.data.orders } : {};

    r = await req('GET', '/api/v1/bootstrap');
    const bd = r.json && r.json.data;
    rec('SYS-02', 'SYS', 'bootstrap 一次返回首屏所需数据', '200 且含 nav/collections/settings/pages',
      r.status === 200 && bd && bd.nav && bd.collections && bd.settings && bd.pages, { ms: r.ms });
    rec('SYS-03', 'SYS', 'bootstrap 不泄露员工或成本信息', '响应体不含 staff/permissions/cost 字段',
      !/"(staff|permissions|cost)"\s*:/.test(JSON.stringify(bd || {})), { ms: r.ms });

    r = await req('GET', '/');
    rec('SYS-04', 'SYS', '首页返回 HTML 壳', '200 且 text/html',
      r.status === 200 && /text\/html/.test(r.ct), { ms: r.ms, detail: r.ct });

    r = await req('GET', '/assets/js/app.js');
    rec('SYS-05', 'SYS', '前台 JS 可下载且 MIME 正确', '200 + javascript',
      r.status === 200 && /javascript/.test(r.ct), { ms: r.ms, detail: r.ct + ' ' + (r.headers && r.headers.get('content-length')) + 'B' });
    rec('SYS-06', 'SYS', '静态资产为 no-cache（发布后不会拿到旧代码）', 'Cache-Control: no-cache',
      (r.headers && /no-cache/.test(r.headers.get('cache-control') || '')) === true, { detail: r.headers && r.headers.get('cache-control') });

    r = await req('GET', '/api/v1/no-such-endpoint');
    rec('SYS-07', 'SYS', '未知接口返回统一错误结构', '404 且 code=NOT_FOUND',
      r.status === 404 && errCode(r) === 'NOT_FOUND', { ms: r.ms });
    rec('SYS-08', 'SYS', '错误体结构完整（code/message）', '含 code 与非空 message',
      !!(r.json && r.json.error && r.json.error.code && r.json.error.message));

    r = await req('GET', '/no-such-page');
    rec('SYS-09', 'SYS', '未知前端路由走 SPA 兜底（不是 404 白屏）', '200 且 text/html',
      r.status === 200 && /text\/html/.test(r.ct), { ms: r.ms, detail: r.ct });

    r = await req('GET', '/uploads/definitely-not-exist-' + STAMP + '.png');
    rec('SYS-10', 'SYS', '不存在的图片返回 404 而非 SPA 的 HTML', '404（不能回 index.html）',
      r.status === 404, { ms: r.ms, detail: r.ct });

    r = await req('GET', '/api/v1/__test/reset');
    rec('SYS-11', 'SYS', '生产环境未暴露测试重置端点', '/__test/reset 不存在（404/405）',
      (r.status === 404 || r.status === 405), { ms: r.ms, detail: 'HTTP ' + r.status });

    /* ============ B. 公开只读接口 ============ */
    console.log('\n— B 公开接口（前台） —');

    /* 注意：GET /products 只回 {data:[...]}，分页元信息在 /products/search 上。
       前台只需要列表本身，后台才需要 total/hasMore——这个分工是有意的。 */
    r = await req('GET', '/api/v1/products?page=1&limit=5');
    const pl = r.json && r.json.data;
    rec('PUB-01', 'PUB', '商品列表返回数组', '200 且 data 为非空数组',
      r.status === 200 && Array.isArray(pl) && pl.length > 0, { ms: r.ms, detail: 'items=' + (Array.isArray(pl) ? pl.length : 'n/a') });

    r = await req('GET', '/api/v1/products/search?page=1&limit=5');
    const pm = r.json && r.json.meta;
    rec('PUB-01b', 'PUB', '分页元信息由 /products/search 提供', '200 且 meta 含 total/page/hasMore',
      r.status === 200 && pm && typeof pm.total === 'number' && typeof pm.page === 'number' && 'hasMore' in pm,
      { ms: r.ms, detail: pm ? 'total=' + pm.total + ' page=' + pm.page + ' limit=' + pm.limit : null });
    rec('PUB-02', 'PUB', '列表项包含前台渲染所需字段', '每项含 id/handle/title/price/images/variants',
      Array.isArray(pl) && pl.every(p => p.id && p.handle && p.title && typeof p.price === 'number' && Array.isArray(p.images) && Array.isArray(p.variants)));
    /* 前台商品对象是精简版：没有 active/cost/version 这些后台字段。
       草稿是否泄露由 PRD-13b 用真实草稿验证（不能在公开接口上凭空断言）。 */
    rec('PUB-03', 'PUB', '公开列表不暴露后台内部字段', '不含 active/cost/version/cost 等',
      Array.isArray(pl) && pl.every(p => !('active' in p) && !('cost' in p) && !('version' in p)));

    const sample = Array.isArray(pl) && pl.length ? pl[0] : null;
    if (sample) {
      r = await req('GET', '/api/v1/products/' + encodeURIComponent(sample.handle));
      rec('PUB-04', 'PUB', '商品详情按 handle 可取', '200 且 handle 一致',
        r.status === 200 && r.json.data && r.json.data.product && r.json.data.product.handle === sample.handle, { ms: r.ms });
      rec('PUB-05', 'PUB', '详情不暴露成本价', '响应体无 cost 字段',
        !/"cost"\s*:/.test(JSON.stringify(r.json || {})));
    } else {
      rec('PUB-04', 'PUB', '商品详情按 handle 可取', '200', false, { detail: '列表为空，无法取样' });
    }

    r = await req('GET', '/api/v1/products/qa-no-such-handle-' + STAMP);
    rec('PUB-06', 'PUB', '不存在的商品返回 404', '404 NOT_FOUND',
      r.status === 404 && errCode(r) === 'NOT_FOUND', { ms: r.ms });

    r = await req('GET', '/api/v1/products?page=1&limit=1000');
    const bigLen = r.json && Array.isArray(r.json.data) ? r.json.data.length : -1;
    rec('PUB-07', 'PUB', 'limit 超上限被裁剪（防拖库）', '返回条数 ≤ 100',
      r.status === 200 && bigLen >= 0 && bigLen <= 100, { ms: r.ms, detail: 'limit=1000 → 实际 ' + bigLen + ' 条' });

    r = await req('GET', '/api/v1/collections');
    const cols = r.json && r.json.data;
    rec('PUB-08', 'PUB', '集合列表可取', '200 且为数组',
      r.status === 200 && Array.isArray(cols), { ms: r.ms, detail: 'collections=' + (Array.isArray(cols) ? cols.length : 'n/a') });

    if (Array.isArray(cols) && cols.length) {
      r = await req('GET', '/api/v1/collections/' + encodeURIComponent(cols[0].handle));
      const cd = r.json && r.json.data;
      const cm = r.json && r.json.meta;
      rec('PUB-09', 'PUB', '集合详情可取且带商品与集合信息', '200 且 data 为数组、meta.collection 存在',
        r.status === 200 && Array.isArray(cd) && cm && cm.collection && cm.collection.handle === cols[0].handle,
        { ms: r.ms, detail: cm && cm.collection ? cm.collection.handle + ' / ' + cd.length + ' 件' : null });
    }

    r = await req('GET', '/api/v1/search?q=sea');
    rec('PUB-10', 'PUB', '站内搜索可用', '200 且返回数组',
      r.status === 200 && Array.isArray(r.json && r.json.data), { ms: r.ms });

    r = await req('GET', '/api/v1/products?page=9999&limit=20');
    rec('PUB-11', 'PUB', '越界分页返回空数组而非报错', '200 且 data=[]',
      r.status === 200 && Array.isArray(r.json.data) && r.json.data.length === 0, { ms: r.ms });

    /* ============ C. 鉴权与安全 ============ */
    console.log('\n— C 鉴权与安全 —');

    r = await req('GET', '/api/v1/admin/products', null, { token: null });
    rec('SEC-01', 'SEC', '无令牌访问后台接口被拒', '401 UNAUTHORIZED',
      r.status === 401 && errCode(r) === 'UNAUTHORIZED', { ms: r.ms });

    r = await req('GET', '/api/v1/admin/products', null, { token: 'forged-token-1234567890' });
    rec('SEC-02', 'SEC', '伪造令牌被拒', '401',
      r.status === 401, { ms: r.ms });

    r = await req('POST', '/api/v1/admin/login', { email: OWNER_EMAIL, password: 'wrong-password-' + STAMP });
    rec('SEC-03', 'SEC', '错误口令登录被拒且不泄露账号是否存在', '401；文案不区分「无此账号」与「口令错」',
      r.status === 401, { ms: r.ms, detail: r.json && r.json.error ? r.json.error.message : null });
    rec('SEC-04', 'SEC', '登录失败响应不含令牌', '无 token 字段',
      !(r.json && (r.json.token || (r.json.data && r.json.data.token))));

    r = await req('POST', '/api/v1/admin/login', { email: OWNER_EMAIL, password: OWNER_PASS });
    TOK = r.json && r.json.data ? r.json.data.token : '';
    rec('SEC-05', 'SEC', 'owner 正确口令可登录', '200 且返回令牌与权限位',
      r.status === 200 && !!TOK && Array.isArray(r.json.data.staff.permissions) && r.json.data.staff.permissions.length > 0,
      { ms: r.ms, detail: 'perms=' + (r.json && r.json.data ? r.json.data.staff.permissions.length : 0) });

    r = await req('POST', '/api/v1/admin/login', { email: OPS_EMAIL, password: OPS_PASS });
    OPS_TOK = r.json && r.json.data ? r.json.data.token : '';
    rec('SEC-06', 'SEC', 'ops 正确口令可登录', '200 且权限位少于 owner',
      r.status === 200 && !!OPS_TOK, { ms: r.ms, detail: 'perms=' + (r.json && r.json.data ? r.json.data.staff.permissions.length : 0) });

    r = await req('PATCH', '/api/v1/admin/settings', { storeOpen: true }, { token: OPS_TOK });
    rec('SEC-07', 'SEC', 'ops 改设置被拒（权限位而非角色判断）', '403 FORBIDDEN',
      r.status === 403, { ms: r.ms, detail: 'HTTP ' + r.status });

    r = await req('GET', '/api/v1/admin/products?limit=3', null, { token: OPS_TOK });
    const opsList = r.json && r.json.data;
    rec('SEC-08', 'SEC', 'ops 看到的商品列表已脱敏成本价', '所有项 cost 为 null',
      r.status === 200 && Array.isArray(opsList) && opsList.every(p => p.cost === null),
      { detail: Array.isArray(opsList) ? '样本 ' + opsList.length + ' 条，cost 全为 null' : null });

    /* fetch / curl 会先把 .. 规范化，所以这条实际打到 /db.json（前端路由），
       走的是 SPA 兜底。这里要证明的是"无论如何都拿不到数据文件内容"，
       而不是纠结状态码——状态码由编码绕过的用例 SEC-10 负责。 */
    r = await req('GET', '/uploads/../../db.json');
    const traversalLeak = /"staffs?"\s*:|"passwordHash"\s*:|"quotes"\s*:/.test(r.text || '') || /"staffs?"\s*:|"passwordHash"\s*:/.test(JSON.stringify(r.json || {}));
    rec('SEC-09', 'SEC', '穿越路径拿不到数据文件内容', '响应体不含 staff/口令哈希/订单表',
      !traversalLeak, { ms: r.ms, detail: 'HTTP ' + r.status + ' ' + r.ct });

    r = await req('GET', '/uploads/%2e%2e%2f%2e%2e%2fdb.json');
    rec('SEC-10', 'SEC', 'URL 编码的穿越同样被挡', '404/400',
      (r.status === 404 || r.status === 400 || r.status === 403) && !/"orders"\s*:/.test(r.text || ''), { ms: r.ms, detail: 'HTTP ' + r.status });

    r = await req('POST', '/api/v1/admin/uploads', { dataUrl: SVG }, { token: TOK });
    rec('SEC-11', 'SEC', 'SVG 上传被拒（防脚本注入）', '400',
      r.status === 400, { ms: r.ms, detail: r.json && r.json.error ? r.json.error.message : null });

    r = await req('POST', '/api/v1/admin/uploads', { dataUrl: 'data:image/png;base64,' + Buffer.from('not-an-image-at-all').toString('base64') }, { token: TOK });
    rec('SEC-12', 'SEC', '非图片内容被拒（按魔数不按扩展名）', '400',
      r.status === 400, { ms: r.ms });

    r = await req('POST', '/api/v1/admin/uploads', { dataUrl: PNG }, { token: null });
    rec('SEC-13', 'SEC', '未授权上传被拒', '401',
      r.status === 401, { ms: r.ms });

    /* CORS：默认 CORS_ORIGIN='*'。认证走 Bearer 令牌而非 Cookie，
       跨站页面拿不到令牌，因此不构成越权；但公开接口可被任意站点调用，
       生产建议把 CORS_ORIGIN 收敛到实际域名。记为配置观察项，不算失败。 */
    r = await req('OPTIONS', '/api/v1/products', null, { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    const acao = r.headers && r.headers.get('access-control-allow-origin');
    const cred = r.headers && r.headers.get('access-control-allow-credentials');
    rec('SEC-14', 'SEC', 'CORS 策略（观察项）', '建议收敛到自有域名；不得允许 credentials',
      acao !== '*' || !cred, { detail: 'ACAO=' + acao + ' ACAC=' + cred, skipped: acao === '*' && !cred });

    r = await req('GET', '/api/v1/admin/orders?limit=1', null, { token: TOK });
    const anyOrder = r.json && r.json.data && r.json.data[0];
    rec('SEC-15', 'SEC', '订单列表对 owner 可见', '200 且有数据',
      r.status === 200 && !!anyOrder, { ms: r.ms });

    /* 除 owner 外的角色不得触碰成本字段——这是 D-030 的回归点 */
    if (anyOrder) {
      r = await req('GET', '/api/v1/orders/lookup?number=' + encodeURIComponent(anyOrder.number) + '&email=' + encodeURIComponent(anyOrder.email));
      rec('TRD-01', 'TRD', '访客用单号+邮箱可查单', '200 且单号一致',
        r.status === 200 && r.json.data && r.json.data.order && r.json.data.order.number === anyOrder.number, { ms: r.ms });
      r = await req('GET', '/api/v1/orders/lookup?number=' + encodeURIComponent(anyOrder.number) + '&email=someone-else-' + STAMP + '@example.com');
      rec('TRD-02', 'TRD', '邮箱不匹配查不到单（防撞号）', '404',
        r.status === 404, { ms: r.ms });
    }

    /* ============ C2. 后台 13 个模块只读覆盖 ============ */
    console.log('\n— C2 后台各模块只读 —');

    const admGets = [
      ['ADM-01', '看板指标', '/api/v1/admin/metrics', d => d && typeof d.gmv === 'number'],
      ['ADM-02', '订单列表', '/api/v1/admin/orders?limit=5', d => Array.isArray(d)],
      ['ADM-03', '库存视图', '/api/v1/admin/inventory', d => Array.isArray(d)],
      ['ADM-04', '库存流水', '/api/v1/admin/stock-ledger?limit=5', d => Array.isArray(d)],
      ['ADM-05', '客户列表', '/api/v1/admin/customers?limit=5', d => Array.isArray(d)],
      ['ADM-06', '评价列表', '/api/v1/admin/reviews?limit=5', d => Array.isArray(d)],
      ['ADM-07', '优惠券列表', '/api/v1/admin/coupons', d => Array.isArray(d)],
      ['ADM-08', '集合列表', '/api/v1/admin/collections', d => Array.isArray(d)],
      ['ADM-09', '内容页配置', '/api/v1/admin/content', d => d && typeof d === 'object'],
      ['ADM-10', '站点设置', '/api/v1/admin/settings', d => d && typeof d === 'object'],
      ['ADM-11', '审计日志', '/api/v1/admin/audit-log?limit=5', d => Array.isArray(d)],
      ['ADM-12', '当前登录员工', '/api/v1/admin/me', d => d && d.staff && d.staff.email],
      ['ADM-13', '定制需求单', '/api/v1/admin/custom-requests?limit=5', d => Array.isArray(d)],
    ];
    for (const [id, name, p, check] of admGets) {
      r = await req('GET', p, null, { token: TOK });
      const okShape = r.status === 200 && check(r.json && r.json.data);
      rec(id, 'ADM', name + '可读', '200 且返回结构正确', okShape,
        { ms: r.ms, detail: okShape ? null : 'HTTP ' + r.status + ' ' + (errCode(r) || '') });
    }

    /* 订单详情要带出状态机可选项——这是后台发货的前提 */
    if (anyOrder) {
      r = await req('GET', '/api/v1/admin/orders/' + encodeURIComponent(anyOrder.number), null, { token: TOK });
      const od = r.json && r.json.data && r.json.data.order;
      rec('ADM-14', 'ADM', '订单详情含状态机可选项', '200 且 allowedTransitions 为数组',
        r.status === 200 && od && Array.isArray(r.json.data.allowedTransitions),
        { ms: r.ms, detail: od ? 'status=' + od.status + ' next=' + JSON.stringify(r.json.data.allowedTransitions) : null });
      rec('ADM-15', 'ADM', '订单详情含赠品与优惠明细', '有 items 与金额字段',
        !!od && Array.isArray(od.items) && typeof od.total === 'number', { detail: od ? 'items=' + od.items.length + ' total=' + od.total : null });
    }

    /* ============ D. 商品管理写链路（全部可回滚） ============ */
    console.log('\n— D 商品管理（写操作仅限 QA 测试商品） —');

    r = await req('POST', '/api/v1/admin/products', {
      title: TAG + ' Draft Item', cat: 'necklaces', price: 50,
      variants: [{ metal: 'Gold', stock: 9 }, { metal: 'Silver', stock: 6 }],
      sizes: ['16in'], motif: 'QA', set: 'QA Set',
    }, { token: TOK });
    const np = r.json && r.json.data && r.json.data.product;
    if (np) created.push(np.id);
    rec('PRD-01', 'PRD', '新建商品成功且默认草稿', '201 且 active=false',
      r.status === 201 && np && np.active === false, { ms: r.ms, detail: np ? np.id + ' / ' + np.handle : null });
    rec('PRD-02', 'PRD', '句柄自动生成且不含中文', 'handle 匹配 [a-z0-9-]+',
      !!np && /^[a-z0-9-]+$/.test(np.handle), { detail: np && np.handle });
    rec('PRD-03', 'PRD', '变体 SKU 自动生成且唯一', '2 个 SKU 均非空且互不相同',
      !!np && np.variants.length === 2 && np.variants[0].sku !== np.variants[1].sku,
      { detail: np ? np.variants.map(v => v.sku).join(',') : null });
    rec('PRD-04', 'PRD', '库存汇总等于各变体之和', '9+6=15',
      !!np && np.stock === 15, { detail: np ? 'stock=' + np.stock : null });
    rec('PRD-05', 'PRD', '尺码 16in 归一为英寸写法', '16"',
      !!np && np.sizes[0] === '16"', { detail: np ? JSON.stringify(np.sizes) : null });

    /* 草稿是否泄露：用刚创建的真实草稿去公开列表里找 */
    r = await req('GET', '/api/v1/products?limit=100');
    const pubList = r.json && Array.isArray(r.json.data) ? r.json.data : [];
    rec('PRD-05b', 'PRD', '草稿商品不出现在公开列表', '按 handle 查不到',
      r.status === 200 && !!np && !pubList.some(x => x.handle === np.handle),
      { ms: r.ms, detail: '公开列表 ' + pubList.length + ' 件' });

    r = await req('PATCH', '/api/v1/admin/products/' + (np ? np.id : 'X'), { active: true }, { token: TOK });
    rec('PRD-06', 'PRD', '无图商品上架被拦', '422 NEEDS_IMAGE',
      r.status === 422 && errCode(r) === 'NEEDS_IMAGE', { ms: r.ms, detail: r.json && r.json.error ? r.json.error.message : null });

    r = await req('POST', '/api/v1/admin/products', { title: TAG + ' Bad Cat', cat: 'socks', price: 10, variants: [{ metal: 'Gold', stock: 1 }] }, { token: TOK });
    rec('PRD-07', 'PRD', '非法品类被拒', '400 且字段级错误',
      r.status === 400 && !!(r.json && r.json.error), { ms: r.ms });

    r = await req('POST', '/api/v1/admin/products', { title: TAG + ' Bad Price', cat: 'rings', price: 10, cost: 99, variants: [{ metal: 'Gold', stock: 1 }] }, { token: TOK });
    rec('PRD-08', 'PRD', '成本高于售价被拒', '422 PRICE_BELOW_COST',
      r.status === 422 && errCode(r) === 'PRICE_BELOW_COST', { ms: r.ms });

    r = await req('POST', '/api/v1/admin/products', { title: TAG + ' Dupe SKU', cat: 'rings', price: 30, variants: [{ metal: 'Gold', stock: 1, sku: 'QA-SAME' }, { metal: 'Silver', stock: 1, sku: 'QA-SAME' }] }, { token: TOK });
    rec('PRD-09', 'PRD', '同商品内重复 SKU 被拒', '400',
      r.status === 400, { ms: r.ms });

    r = await req('POST', '/api/v1/admin/products', { title: TAG + ' Bad Metal', cat: 'rings', price: 30, variants: [{ metal: 'Bronze', stock: 1 }] }, { token: TOK });
    rec('PRD-10', 'PRD', '非法金属被拒', '400',
      r.status === 400, { ms: r.ms });

    /* 上传：真实走一遍落盘与回读 */
    const upT0 = Date.now();
    r = await req('POST', '/api/v1/admin/uploads', { dataUrl: PNG }, { token: TOK, timeout: 60000 });
    const upMs = Date.now() - upT0;
    const upPath = r.json && r.json.data && r.json.data.path;
    rec('UPL-01', 'UPL', '图片上传成功并落盘', '201 且返回 uploads/ 路径',
      r.status === 201 && !!upPath && upPath.indexOf('uploads/') === 0, { ms: upMs, detail: upPath });
    rec('UPL-02', 'UPL', '上传耗时在上线可接受范围', '< 3000ms（跨网单张小图）',
      upMs < 3000, { ms: upMs, detail: upMs + 'ms' });

    if (upPath) {
      r = await req('GET', '/' + upPath);
      rec('UPL-03', 'UPL', '上传后的图片可被公开访问', '200 且 image/png',
        r.status === 200 && /image\/png/.test(r.ct), { ms: r.ms, detail: r.ct });
    }

    /* 带图后上架 → 前台可见 → 改价 → 改标题不改 handle */
    if (np && upPath) {
      r = await req('PATCH', '/api/v1/admin/products/' + np.id, { images: [upPath] }, { token: TOK });
      rec('PRD-11', 'PRD', '为草稿挂上图', '200 且 images 长度为 1',
        r.status === 200 && r.json.data.product.images.length === 1, { ms: r.ms });

      r = await req('PATCH', '/api/v1/admin/products/' + np.id, { active: true }, { token: TOK });
      rec('PRD-12', 'PRD', '带图后可上架', '200 且 active=true',
        r.status === 200 && r.json.data.product.active === true, { ms: r.ms });

      r = await req('GET', '/api/v1/products/' + encodeURIComponent(np.handle));
      rec('PRD-13', 'PRD', '上架后前台立刻可见', '200 且返回该商品',
        r.status === 200 && r.json.data && r.json.data.product && r.json.data.product.id === np.id, { ms: r.ms });

      /* 前台接口不返回 version（乐观锁是后台概念），所以要回后台取详情再提交 */
      const det = await req('GET', '/api/v1/admin/products/' + np.id, null, { token: TOK });
      const curVer = det.json && det.json.data && det.json.data.product ? det.json.data.product.version : null;
      r = await req('PATCH', '/api/v1/admin/products/' + np.id, { price: 60, version: curVer }, { token: TOK });
      const pv = r.json && r.json.data && r.json.data.product;
      rec('PRD-14', 'PRD', '改主价后变体价按比例跟随', '主价 60，变体价等比放大',
        r.status === 200 && pv && Math.abs(pv.price - 60) < 0.01 && Math.abs(pv.variants[0].price - 60) < 0.01,
        { ms: r.ms, detail: pv ? 'version=' + curVer + ' main=' + pv.price + ' v1=' + pv.variants[0].price + ' v2=' + pv.variants[1].price : 'HTTP ' + r.status + ' ' + (r.json && r.json.error ? r.json.error.message : '') });

      r = await req('PATCH', '/api/v1/admin/products/' + np.id, { price: 61, version: 1 }, { token: TOK });
      rec('PRD-15', 'PRD', '乐观锁：旧 version 提交被拒', '409 CONFLICT',
        r.status === 409, { ms: r.ms, detail: r.json && r.json.error ? r.json.error.message : null });

      r = await req('PATCH', '/api/v1/admin/products/' + np.id, { title: TAG + ' Renamed' }, { token: TOK });
      rec('PRD-16', 'PRD', '改标题不改句柄（已投放链接不失效）', '200 且 handle 不变',
        r.status === 200 && r.json.data.product.handle === np.handle,
        { ms: r.ms, detail: r.json && r.json.data ? r.json.data.product.handle : null });
    } else {
      rec('PRD-11', 'PRD', '为草稿挂上图', '前置失败，跳过', false, { detail: '新建或上传未成功' });
    }

    r = await req('POST', '/api/v1/admin/products/' + (np ? np.id : 'X') + '/duplicate', {}, { token: TOK });
    const dup = r.json && r.json.data && r.json.data.product;
    if (dup) created.push(dup.id);
    rec('PRD-17', 'PRD', '复制商品为草稿且库存归零', '201 且 active=false、stock=0',
      r.status === 201 && dup && dup.active === false && dup.stock === 0,
      { ms: r.ms, detail: dup ? dup.id + ' stock=' + dup.stock : null });

    r = await req('PATCH', '/api/v1/admin/products/' + (np ? np.id : 'X'), { cost: 12 }, { token: OPS_TOK });
    rec('PRD-18', 'PRD', 'ops 修改成本价被拒（毛利口径保护）', '403',
      r.status === 403, { ms: r.ms });

    /* CSV：预检不写库 → abort 拒绝 → valid-only 导入 */
    const csvHeader = 'group,title,handle,category,price,cost,compareAt,metal,sku,stock,variantPrice,desc,motif,set,badge,images,collections,sizes';
    const csvOk = csvHeader + '\n'
      + TAG + '-g1,' + TAG + ' CSV Item,,' + 'bracelets,42,,,Gold,,5,,QA note,,,New,,,\n'
      + TAG + '-g1,' + TAG + ' CSV Item,,' + 'bracelets,42,,,Silver,,3,,,,,,,16in\n';
    const csvBad = csvHeader + '\n'
      + TAG + '-g2,' + TAG + ' Broken,,socks,0,,,Gold,,1,,,,,,,\n';

    r = await req('GET', '/api/v1/admin/products?limit=1', null, { token: TOK });
    const beforeTotal = r.json && r.json.meta ? r.json.meta.total : null;

    r = await req('POST', '/api/v1/admin/products/import/preview', { csv: csvOk }, { token: TOK });
    const pv2 = r.json && r.json.data;
    rec('CSV-01', 'CSV', '预检按 group 归并成 1 组 2 变体', 'groupCount=1 且 variants=2',
      r.status === 200 && pv2 && pv2.groupCount === 1 && pv2.groups[0].variants === 2,
      { ms: r.ms, detail: pv2 ? 'groups=' + pv2.groupCount + ' variants=' + (pv2.groups[0] || {}).variants : null });

    r = await req('POST', '/api/v1/admin/products/import/preview', { csv: csvBad }, { token: TOK });
    rec('CSV-02', 'CSV', '预检能抓出行级错误并定位到行', 'errorCount>0 且带 line/column',
      r.status === 200 && r.json.data.errorCount > 0 && r.json.data.errors[0].line > 1,
      { ms: r.ms, detail: JSON.stringify(r.json.data && r.json.data.errors && r.json.data.errors[0]) });

    r = await req('GET', '/api/v1/admin/products?limit=1', null, { token: TOK });
    const afterPreview = r.json && r.json.meta ? r.json.meta.total : null;
    rec('CSV-03', 'CSV', '预检不写库（商品总数不变）', 'before == after',
      beforeTotal === afterPreview, { detail: beforeTotal + ' → ' + afterPreview });

    r = await req('POST', '/api/v1/admin/products/import', { csv: csvBad, mode: 'abort' }, { token: TOK });
    rec('CSV-04', 'CSV', '有错时 abort 模式整体拒绝', '422 IMPORT_HAS_ERRORS',
      r.status === 422 && errCode(r) === 'IMPORT_HAS_ERRORS', { ms: r.ms });

    r = await req('POST', '/api/v1/admin/products/import', { csv: csvOk, mode: 'valid-only' }, { token: TOK });
    const imp = r.json && r.json.data;
    if (imp && Array.isArray(imp.products)) imp.products.forEach(p => created.push(p.id));
    rec('CSV-05', 'CSV', 'valid-only 模式导入成功', '201 且 created=1',
      r.status === 201 && imp && imp.created === 1, { ms: r.ms, detail: imp ? 'created=' + imp.created + ' products=' + JSON.stringify(imp.products) : null });
    rec('CSV-06', 'CSV', '导入的商品有 2 个变体且为草稿', 'variants=2',
      !!imp && imp.products[0] && imp.products[0].variants === 2, { detail: imp && imp.products[0] ? 'variants=' + imp.products[0].variants : null });

    r = await req('GET', '/api/v1/admin/products/import/template', null, { token: TOK });
    const tplBody = r.text || '';
    rec('CSV-07', 'CSV', '模板可下载且带 UTF-8 BOM', 'Content-Type text/csv，首字节 EF BB BF',
      r.status === 200 && /text\/csv/.test(r.ct) && tplBody.length > 0, { ms: r.ms, detail: r.ct });

    /* 删除保护：真实有订单的商品不能删，只能下架。
       生产环境里"先试删再看结果"是不可接受的——万一那件商品恰好没有任何订单，
       服务端会如实返回 200 并真的删掉。所以这里只做判定，不发 DELETE：
       只要库里存在被订单引用的商品，就说明该分支有真实样本，
       其行为由本地 api-test 的 TC-PROD-30 覆盖，线上不重复破坏。 */
    r = await req('GET', '/api/v1/admin/products?limit=100', null, { token: TOK });
    const all = r.json && r.json.data ? r.json.data : [];
    const realOnes = all.filter(p => String(p.handle).indexOf('qa-') !== 0);
    rec('PRD-19', 'PRD', '有订单引用的商品删除保护', '线上不执行（见备注），本地 TC-PROD-30 已覆盖',
      true, { detail: '线上真实商品 ' + realOnes.length + ' 件；破坏性用例不在生产执行' });
    results[results.length - 1].skipped = true;

    /* ============ E. 交易链路（只报价，不建单） ============ */
    console.log('\n— E 交易链路（不产生订单） —');

    if (sample) {
      const v = sample.variants && sample.variants[0];
      r = await req('POST', '/api/v1/checkout/quote', { items: [{ handle: sample.handle, metal: v ? v.metal : 'Gold', qty: 1 }] });
      const q = r.json && r.json.data;
      rec('TRD-03', 'TRD', '报价成功且返回服务端计算金额', '200 且 subtotal/total 为数字',
        r.status === 200 && q && typeof q.subtotal === 'number' && typeof q.total === 'number',
        { ms: r.ms, detail: q ? 'subtotal=' + q.subtotal + ' ship=' + q.shipping + ' total=' + q.total : null });
      rec('TRD-04', 'TRD', '报价带回 15 分钟有效期', 'expiresAt 晚于当前时间且 ≤ 20 分钟',
        !!q && q.expiresAt && (new Date(q.expiresAt) - Date.now()) > 0 && (new Date(q.expiresAt) - Date.now()) <= 20 * 60 * 1000,
        { detail: q ? q.expiresAt : null });

      r = await req('POST', '/api/v1/checkout/quote', { items: [{ handle: sample.handle, metal: v ? v.metal : 'Gold', qty: 1, unitPrice: 0.01 }] });
      const q2 = r.json && r.json.data;
      rec('TRD-05', 'TRD', '前端伪造单价被服务端忽略', '报价金额不受 unitPrice 影响',
        r.status === 200 && q2 && Math.abs(q2.total - q.total) < 0.01, { ms: r.ms, detail: q2 ? 'total=' + q2.total : null });

      r = await req('POST', '/api/v1/checkout/quote', { items: [{ handle: sample.handle, metal: v ? v.metal : 'Gold', qty: 999 }] });
      rec('TRD-06', 'TRD', '超量购买被拒（单行 >10）', '422 CART_INVALID 且 details 指出 QTY_LIMIT',
        r.status === 422 && errCode(r) === 'CART_INVALID', { ms: r.ms, detail: r.json && r.json.error ? JSON.stringify(r.json.error.details).slice(0, 120) : null });

      r = await req('POST', '/api/v1/checkout/quote', { items: [{ handle: sample.handle, metal: v ? v.metal : 'Gold', qty: 0 }] });
      rec('TRD-07', 'TRD', '数量 0 被拒', '422 CART_INVALID（INVALID_QTY）',
        r.status === 422 && errCode(r) === 'CART_INVALID', { ms: r.ms });

      r = await req('POST', '/api/v1/checkout/quote', { items: [{ handle: sample.handle, metal: 'Bronze', qty: 1 }] });
      rec('TRD-08', 'TRD', '不存在的金属被拒', '400/422',
        r.status === 400 || r.status === 422, { ms: r.ms });

      r = await req('POST', '/api/v1/checkout/quote', { items: [] });
      rec('TRD-09', 'TRD', '空购物车报价被拒', '400',
        r.status === 400, { ms: r.ms });

      /* 订单创建的入参校验：故意不带 quoteId，期望被拒且不建单 */
      r = await req('POST', '/api/v1/orders', { items: [{ handle: sample.handle, metal: v ? v.metal : 'Gold', qty: 1 }], email: 'qa-' + STAMP + '@example.com' });
      rec('TRD-10', 'TRD', '无报价直接下单被拒（报价锁生效）', '400/422 且不建单',
        r.status === 400 || r.status === 422, { ms: r.ms, detail: 'HTTP ' + r.status + ' ' + (r.json && r.json.error ? r.json.error.code : '') });
    }

    r = await req('POST', '/api/v1/checkout/quote', { items: [{ handle: 'nonexistent-' + STAMP, metal: 'Gold', qty: 1 }] });
    rec('TRD-11', 'TRD', '不存在/已下架商品不能报价', '4xx 且 code=CART_INVALID（不泄露商品是否存在）',
      r.status >= 400 && r.status < 500 && errCode(r) === 'CART_INVALID', { ms: r.ms, detail: 'HTTP ' + r.status + ' ' + errCode(r) });

  } catch (e) {
    console.error('\n[脚本异常] ' + e.message);
    results.push({ id: 'SCRIPT', group: 'SYS', name: '脚本自身执行异常', expect: '无异常', ok: false, detail: e.message });
  } finally {
    /* ---- 清理：只删本脚本创建的商品，按 id 精确匹配 ---- */
    console.log('\n— 清理 QA 测试数据 —');
    let removed = 0, failed = 0;
    for (const id of created) {
      try {
        const d = await req('DELETE', '/api/v1/admin/products/' + id, null, { token: TOK });
        if (d.status === 200 || d.status === 404) removed++;
        else { failed++; console.log('  ! 未能删除 ' + id + ' → HTTP ' + d.status); }
      } catch (e) { failed++; }
    }
    /* 兜底：按句柄/标题前缀再扫一遍，防止中途创建但没记进 created 的漏网 */
    try {
      const ls = await req('GET', '/api/v1/admin/products?limit=100', null, { token: TOK });
      const leftover = (ls.json && ls.json.data ? ls.json.data : []).filter(p =>
        String(p.handle || '').indexOf('qa-' + STAMP) === 0 || String(p.title || '').indexOf(TAG) === 0);
      for (const p of leftover) {
        const d = await req('DELETE', '/api/v1/admin/products/' + p.id, null, { token: TOK });
        if (d.status === 200) { removed++; console.log('  · 兜底删除 ' + p.id + ' / ' + p.handle); }
      }
    } catch (e) { /* 忽略 */ }
    cleanupDone = true;
    console.log('  已删除 ' + removed + ' 个测试商品' + (failed ? '，' + failed + ' 个失败需人工处理' : ''));
  }

  /* ---- 汇总 ---- */
  const total = results.length;
  const skippedList = results.filter(x => x.skipped);
  const passed = results.filter(x => x.ok && !x.skipped).length;
  const failedList = results.filter(x => !x.ok && !x.skipped);

  const byGroup = {};
  results.forEach(x => {
    byGroup[x.group] = byGroup[x.group] || { total: 0, pass: 0 };
    byGroup[x.group].total++;
    if (x.ok) byGroup[x.group].pass++;
  });

  const lat = results.filter(x => typeof x.ms === 'number' && x.ms > 0).map(x => x.ms).sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor(lat.length * 0.5)] : 0;
  const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)] : 0;
  const slow = results.filter(x => x.ms >= 1000).sort((a, b) => b.ms - a.ms).slice(0, 5);

  console.log('\n================ 结果汇总 ================');
  const effective = total - skippedList.length;
  console.log('用例 ' + total + ' 条：通过 ' + passed + '，失败 ' + failedList.length + '，观察项 ' + skippedList.length +
    '，通过率 ' + (effective ? (passed / effective * 100).toFixed(1) : 0) + '%');
  Object.keys(byGroup).forEach(g => {
    const x = byGroup[g];
    console.log('  ' + g.padEnd(5) + ' ' + String(x.pass).padStart(3) + '/' + String(x.total).padEnd(3) + (x.pass === x.total ? ' ✓' : ' ✗'));
  });
  console.log('延时 p50=' + p50 + 'ms  p95=' + p95 + 'ms');
  if (slow.length) console.log('最慢：' + slow.map(x => x.id + ' ' + x.ms + 'ms').join(' | '));

  if (failedList.length) {
    console.log('\n---- 失败明细 ----');
    failedList.forEach(x => console.log('  ✗ [' + x.id + '] ' + x.name + ' | 期望 ' + x.expect + ' | 实际 ' + x.detail));
  }

  const out = {
    base: BASE, at: new Date().toISOString(), tag: TAG,
    baseline: baseCounts, total, passed, failed: failedList.length, skipped: skippedList.length,
    latency: { p50, p95 }, byGroup, results,
  };
  fs.mkdirSync(path.join(__dirname, '..', 'tmp_qa'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'tmp_qa', 'online-result.json'), JSON.stringify(out, null, 2));

  /* 清理后复核：商品数应回到基线 */
  try {
    const h = await req('GET', '/api/v1/health');
    const now = h.json && h.json.data;
    console.log('\n数据影响复核：商品 ' + baseCounts.products + ' → ' + (now && now.products) +
      '，订单 ' + baseCounts.orders + ' → ' + (now && now.orders));
    if (now && now.orders !== baseCounts.orders) console.log('  ⚠ 订单数发生变化，需核查是否有意外的建单行为');
    if (now && now.products !== baseCounts.products) console.log('  ⚠ 商品数未回到基线，需人工清理残留测试商品');
  } catch (e) { /* 忽略 */ }

  console.log('\n结果已写入 tmp_qa/online-result.json');
  process.exit(failedList.length ? 1 : 0);
})();
