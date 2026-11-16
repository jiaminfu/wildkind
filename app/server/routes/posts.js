/* ============================================================
   LASTGROVE · 博客接口
   ------------------------------------------------------------
   公开（2 个）：
     GET /api/v1/posts           列表，只返 published，不返正文
     GET /api/v1/posts/:slug     详情，草稿与不存在同样 404

   后台（5 个，需 posts:write）：
     GET    /api/v1/admin/posts
     GET    /api/v1/admin/posts/:id
     POST   /api/v1/admin/posts
     PATCH  /api/v1/admin/posts/:id
     DELETE /api/v1/admin/posts/:id

   列表不返 blocks 是有意的：一篇 30 KB 的正文乘 9 就是 270 KB，
   而列表页一个字的正文都不显示。要正文就点进去。
   ============================================================ */
'use strict';
const store = require('../lib/store');
const auth = require('../lib/auth');
const posts = require('../lib/posts');
const { audit } = require('../lib/audit');
const { ApiError, E, ok, send } = require('../lib/http');

/* 审计只存这三个字段。存整份 blocks 等于把 db.json 复制第二遍，
   审计日志会先于业务数据膨胀，而且真正要查的永远是「谁把哪篇改成什么状态」。 */
function auditMeta(p) {
  return { title: p.title, slug: p.slug, status: p.status };
}

function routes(router) {
  /* ---------------- 公开 ---------------- */
  router.get('/api/v1/posts', (req, res) => {
    const r = posts.listPublic(req.query || {});
    send(res, 200, { data: r.items, meta: r.meta });
  });

  router.get('/api/v1/posts/:slug', (req, res) => {
    const p = posts.getPublic(req.params.slug);
    /* 草稿与不存在必须完全同形 —— 区分开就等于承认「这里有一篇没写完的文章」。 */
    if (!p) throw new ApiError(404, 'POST_NOT_FOUND', 'Article not found.');
    ok(res, p);
  });

  /* ---------------- 后台 ---------------- */
  router.get('/api/v1/admin/posts', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'posts:write');
    const r = posts.listAdmin(req.query || {});
    send(res, 200, { data: r.items, meta: r.meta });
  });

  router.get('/api/v1/admin/posts/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'posts:write');
    const p = posts.getAdmin(req.params.id);
    if (!p) throw E.notFound('No such article.');
    ok(res, p);
  });

  /* 编辑器需要的枚举值：栏目、块类型、各项长度上限。
     放在服务端而不是前端写死，是因为校验也在服务端 —— 两边各写一份，
     迟早出现「后台允许输入 200 字、保存时报 158 字超限」这种自相矛盾。 */
  router.get('/api/v1/admin/post-meta', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'posts:write');
    const R = require('../../web/assets/js/blog-render');
    ok(res, {
      sections: posts.sections(),
      blockTypes: R.BLOCK_TYPES,
      limits: R.limits,
    });
  });

  router.post('/api/v1/admin/posts', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'posts:write');

    const created = store.tx(() => posts.create(req.body || {}, me));
    audit(me, 'post.create', created.id, { after: auditMeta(created) });
    store.flush();

    ok(res, created, 201);
  });

  router.patch('/api/v1/admin/posts/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'posts:write');

    const before = posts.getAdmin(req.params.id);
    if (!before) throw E.notFound('No such article.');

    const updated = store.tx(() => posts.update(req.params.id, req.body || {}, me));
    if (!updated) throw E.notFound('No such article.');

    audit(me, 'post.update', updated.id, { before: auditMeta(before), after: auditMeta(updated) });
    store.flush();

    ok(res, updated);
  });

  router.delete('/api/v1/admin/posts/:id', (req, res) => {
    const me = auth.requireAuth(req);
    auth.requirePerm(me, 'posts:write');

    const gone = store.tx(() => posts.remove(req.params.id));
    if (!gone) throw E.notFound('No such article.');

    audit(me, 'post.delete', gone.id, { before: auditMeta(gone) });
    store.flush();

    ok(res, { deleted: true, id: gone.id });
  });
}

module.exports = { routes };
