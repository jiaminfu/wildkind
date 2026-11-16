/* ============================================================
   LASTGROVE API · 博客（列表 / 详情 / 后台增删改发 / 校验 / 权限 / 安全）
   用法：BASE=http://127.0.0.1:4600 node tools/api-test-blog.js

   依赖 __test/reset（ALLOW_TEST_RESET=1 启动）。开跑前复位一次，
   跑完再复位一次 —— 每轮结束都回到「3 篇种子 + 一个 owner」，
   不会在库里留下测试文章。

   这个套件验的是「接口语义」，页面的真浏览器行为在 tools/e2e-blog.js。
   ============================================================ */
'use strict';
const BASE = (process.env.BASE || process.argv[2] || 'http://127.0.0.1:4600').replace(/\/$/, '');
const OWNER = { email: 'owner@lastgrove.com', password: 'lastgrove2026' };
const STAMP = Date.now().toString(36);
const SUPPORT_EMAIL = 'blog-support-' + STAMP + '@example.com';
const OPS_EMAIL = 'blog-ops-' + STAMP + '@example.com';
const TMP_PASS = 'blogtest2026';

let pass = 0, fail = 0;
const failures = [];
function chk(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

async function call(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}
const reset = () => call('POST', '/api/v1/__test/reset');

(async () => {
  /* ---------- 0 复位 ---------- */
  section('0 复位与登录');
  const r0 = await reset();
  if (r0.status !== 200) {
    console.log('  ⚠️  需要 ALLOW_TEST_RESET=1 启动服务，已中止。');
    process.exit(2);
  }
  chk('已复位到基线', true);

  const login = await call('POST', '/api/v1/admin/login', OWNER);
  const owner = 'Bearer ' + ((login.body && login.body.data && login.body.data.token) || '');
  chk('owner 登录成功', login.status === 200);
  chk('owner 权限含 posts:write',
    (login.body.data.staff.permissions || []).indexOf('posts:write') >= 0);

  try {
    /* ---------- 1 公开列表 ---------- */
    section('1 公开列表');
    const list1 = await call('GET', '/api/v1/posts');
    chk('GET /posts 200', list1.status === 200);
    chk('种子文章 3 篇', (list1.body.data || []).length === 3,
      'actual=' + (list1.body.data || []).length);
    chk('列表项不含 blocks（正文不进列表）',
      (list1.body.data || []).every(p => p.blocks === undefined));
    chk('按发布时间倒序',
      (list1.body.data || []).map(p => p.publishedAt).join() ===
      [...(list1.body.data || [])].map(p => p.publishedAt).sort().reverse().join());

    const bySec = await call('GET', '/api/v1/posts?section=materials');
    chk('按 section 筛选只回该栏目',
      bySec.status === 200 && bySec.body.data.length === 1 && bySec.body.data[0].section === 'materials',
      'n=' + (bySec.body.data || []).length);

    const badSec = await call('GET', '/api/v1/posts?section=nope');
    chk('未知 section 返回空列表而不是报错',
      badSec.status === 200 && badSec.body.data.length === 0);

    const bigLimit = await call('GET', '/api/v1/posts?limit=999');
    chk('limit 上限被夹到 24', bigLimit.status === 200 && bigLimit.body.meta.limit <= 24,
      'limit=' + bigLimit.body.meta.limit);

    /* ---------- 2 公开详情 ---------- */
    section('2 公开详情');
    const one = await call('GET', '/api/v1/posts/why-pvd-is-not-plating');
    chk('详情 200 且带 blocks', one.status === 200 && Array.isArray(one.body.data.blocks) &&
      one.body.data.blocks.length > 3, 'blocks=' + (one.body.data.blocks || []).length);
    chk('详情带 prev/next 导航',
      'prev' in one.body.data && 'next' in one.body.data,
      'prev=' + (one.body.data.prev && one.body.data.prev.slug) +
      ' next=' + (one.body.data.next && one.body.data.next.slug));

    const missing = await call('GET', '/api/v1/posts/does-not-exist');
    chk('不存在的文章 404 且 code=POST_NOT_FOUND',
      missing.status === 404 && missing.body.error.code === 'POST_NOT_FOUND',
      missing.body.error && missing.body.error.code);

    /* ---------- 3 后台 CRUD ---------- */
    section('3 后台增删改发');
    const created = await call('POST', '/api/v1/admin/posts', {
      title: 'Test article ' + STAMP,
      excerpt: 'Created by api-test-blog.',
      section: 'studio',
      blocks: [
        { type: 'p', text: 'First paragraph with **bold** text.' },
        { type: 'h2', text: 'A heading' },
        { type: 'image', src: 'https://evil.example.com/x.jpg', alt: 'should be dropped' },
      ],
    }, { Authorization: owner });
    chk('创建草稿 201', created.status === 201, 'status=' + created.status);
    const pid = created.body.data && created.body.data.id;
    chk('新文章默认 draft 且无发布时间',
      created.body.data.status === 'draft' && !created.body.data.publishedAt);
    chk('非法图片块被静默丢弃（外链 src）',
      created.body.data.blocks.length === 2,
      'blocks=' + created.body.data.blocks.length);

    const pubList = await call('GET', '/api/v1/posts');
    chk('草稿不出现在公开列表',
      !pubList.body.data.some(p => p.id === pid));

    const draftGet = await call('GET', '/api/v1/posts/' + created.body.data.slug);
    chk('草稿详情与不存在同形（都是 404 POST_NOT_FOUND）',
      draftGet.status === 404 && draftGet.body.error.code === 'POST_NOT_FOUND');

    const pub = await call('PATCH', '/api/v1/admin/posts/' + pid,
      { status: 'published' }, { Authorization: owner });
    chk('PATCH 改为 published 时自动补发布时间',
      pub.status === 200 && !!pub.body.data.publishedAt);

    const afterPub = await call('GET', '/api/v1/posts/' + created.body.data.slug);
    chk('发布后公开详情立即可见', afterPub.status === 200);

    const backToDraft = await call('PATCH', '/api/v1/admin/posts/' + pid,
      { status: 'draft' }, { Authorization: owner });
    chk('退回草稿时保留原发布时间（不重新排期）',
      backToDraft.body.data.publishedAt === pub.body.data.publishedAt,
      backToDraft.body.data.publishedAt);

    const del = await call('DELETE', '/api/v1/admin/posts/' + pid, undefined,
      { Authorization: owner });
    chk('删除 200', del.status === 200 && del.body.data.deleted === true);
    const gone = await call('GET', '/api/v1/admin/posts/' + pid, undefined, { Authorization: owner });
    chk('删除后后台详情 404', gone.status === 404);

    /* ---------- 4 校验 ---------- */
    section('4 字段校验');
    const noTitle = await call('POST', '/api/v1/admin/posts', { blocks: [] },
      { Authorization: owner });
    chk('缺 title → 400 且 field=title',
      noTitle.status === 400 && noTitle.body.error.details &&
      noTitle.body.error.details[0].field === 'title',
      noTitle.body.error && noTitle.body.error.message);

    const badSlug = await call('POST', '/api/v1/admin/posts',
      { title: 'X', slug: 'Not A Slug!!' }, { Authorization: owner });
    chk('非法 slug → 400（大写与符号都会被拒或归一）',
      badSlug.status === 400 || (badSlug.body.data && /^[a-z0-9-]+$/.test(badSlug.body.data.slug)),
      badSlug.status === 400 ? badSlug.body.error.details[0].message : badSlug.body.data.slug);

    const longSeo = await call('POST', '/api/v1/admin/posts',
      { title: 'X', seoDescription: 'a'.repeat(159) }, { Authorization: owner });
    chk('seoDescription > 158 → 400',
      longSeo.status === 400 && longSeo.body.error.details[0].field === 'seoDescription');

    const badSection = await call('POST', '/api/v1/admin/posts',
      { title: 'X', section: 'nonsense' }, { Authorization: owner });
    chk('未知 section → 400', badSection.status === 400 &&
      badSection.body.error.details[0].field === 'section');

    const junkBlocks = await call('POST', '/api/v1/admin/posts',
      { title: 'X', blocks: [{ type: 'script', text: 'x' }, { type: 'p', text: '' }] },
      { Authorization: owner });
    chk('传了非空 blocks 却全被丢弃 → 400（防「存成空文章」）',
      junkBlocks.status === 400 && junkBlocks.body.error.details[0].field === 'blocks');

    /* ---------- 5 slug 唯一 ---------- */
    section('5 slug 唯一化');
    const a1 = await call('POST', '/api/v1/admin/posts',
      { title: 'Duplicate slug test', slug: 'dup-slug-' + STAMP }, { Authorization: owner });
    const a2 = await call('POST', '/api/v1/admin/posts',
      { title: 'Duplicate slug test again', slug: 'dup-slug-' + STAMP }, { Authorization: owner });
    chk('同 slug 第二次创建自动加 -2',
      a2.status === 201 && a2.body.data.slug === 'dup-slug-' + STAMP + '-2',
      a2.body.data && a2.body.data.slug);

    const a3 = await call('POST', '/api/v1/admin/posts',
      { title: 'Third', slug: 'dup-slug-' + STAMP }, { Authorization: owner });
    chk('第三次自动加 -3',
      a3.status === 201 && a3.body.data.slug === 'dup-slug-' + STAMP + '-3',
      a3.body.data && a3.body.data.slug);

    /* ---------- 6 权限 ---------- */
    section('6 权限位');
    const mkSupport = await call('POST', '/api/v1/admin/staff', {
      email: SUPPORT_EMAIL, name: 'Blog Support', role: 'support', password: TMP_PASS,
    }, { Authorization: owner });
    chk('可创建 support 账号', mkSupport.status === 200 || mkSupport.status === 201,
      'status=' + mkSupport.status);

    const sLogin = await call('POST', '/api/v1/admin/login',
      { email: SUPPORT_EMAIL, password: TMP_PASS });
    const support = 'Bearer ' + ((sLogin.body && sLogin.body.data && sLogin.body.data.token) || '');
    chk('support 登录成功', sLogin.status === 200);
    chk('support 没有 posts:write',
      (sLogin.body.data.staff.permissions || []).indexOf('posts:write') < 0);

    const sWrite = await call('POST', '/api/v1/admin/posts',
      { title: 'Support should not write' }, { Authorization: support });
    chk('support 建文章 → 403', sWrite.status === 403, 'status=' + sWrite.status);

    const sRead = await call('GET', '/api/v1/admin/posts', undefined, { Authorization: support });
    chk('support 读后台列表 → 403', sRead.status === 403, 'status=' + sRead.status);

    const sPublic = await call('GET', '/api/v1/posts');
    chk('support 仍能读公开列表（不需要权限位）', sPublic.status === 200);

    /* ---------- 7 安全 ---------- */
    section('7 存储型 XSS');
    const xss = await call('POST', '/api/v1/admin/posts', {
      title: '<script>alert(1)</script>',
      excerpt: '<img src=x onerror=alert(1)>',
      section: 'care',
      blocks: [{ type: 'p', text: '[click](javascript:alert(1)) and <b>tag</b>' }],
      status: 'published',
    }, { Authorization: owner });
    const xssSlug = xss.body.data && xss.body.data.slug;

    const xssPage = await fetch(BASE + '/journal/' + xssSlug).then(r => r.text());
    chk('标题里的 <script> 在预渲染 HTML 里被转义',
      xssPage.indexOf('<script>alert(1)</script>') < 0 &&
      xssPage.indexOf('&lt;script&gt;alert(1)') > 0);
    chk('摘要里的 <img onerror> 被转义',
      xssPage.indexOf('onerror=alert(1)') < 0 ||
      xssPage.indexOf('&lt;img src=x onerror=alert(1)&gt;') > 0);
    chk('正文里的 javascript: 链接降级为纯文本（不产生 <a href="javascript:）',
      xssPage.indexOf('href="javascript:') < 0);

    /* ---------- 8 缓存失效与 sitemap ---------- */
    section('8 缓存与 sitemap');
    const sm1 = await fetch(BASE + '/sitemap.xml').then(r => r.text());
    chk('sitemap 含新发布文章的 URL', sm1.indexOf('/journal/' + xssSlug) > 0);
    chk('sitemap 不含 #/ 假 URL（爬虫眼里全等于首页）', sm1.indexOf('/#/') < 0);
    chk('sitemap 带 lastmod', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sm1));

    /* 改标题后预渲染页应立即反映（postsRev 让缓存整体作废） */
    const newTitle = 'Renamed ' + STAMP;
    await call('PATCH', '/api/v1/admin/posts/' + xss.body.data.id,
      { title: newTitle }, { Authorization: owner });
    const after = await fetch(BASE + '/journal/' + xssSlug).then(r => r.text());
    chk('改标题后预渲染页立即更新（缓存按 postsRev 失效）',
      after.indexOf(newTitle + ' — LASTGROVE') > 0);

    /* ---------- 9 审计 ---------- */
    section('9 审计');
    const auditRes = await call('GET', '/api/v1/admin/audit-log', undefined,
      { Authorization: owner });
    const actions = (auditRes.body && auditRes.body.data || []).map(a => a.action);
    chk('写操作留下 post.create 审计',
      actions.indexOf('post.create') >= 0, actions.slice(0, 5).join(','));
    chk('写操作留下 post.update 审计', actions.indexOf('post.update') >= 0);
    chk('写操作留下 post.delete 审计', actions.indexOf('post.delete') >= 0);

  } catch (e) {
    console.error('\n执行中断：', e.message);
    fail++;
  } finally {
    await reset();
    console.log('\n════════ 汇总 ════════');
    console.log(`合计 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
    if (fail) {
      console.log('\n失败明细：');
      failures.forEach(f => console.log('  ✗ ' + f));
    }
    console.log('（已复位到基线）');
    process.exit(fail ? 1 : 0);
  }
})();
