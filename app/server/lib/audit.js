/* ============================================================
   LASTGROVE · 操作审计
   ------------------------------------------------------------
   每个后台写操作都往 auditLog 里压一条。它的用途不是「记录一切」，
   而是回答三个具体问题：谁改的、什么时候改的、改前长什么样。

   只存 before/after 的关键字段，不存整份对象 ——
   存整个商品或整篇文章等于把 db.json 复制第二遍，日志表会先于业务表膨胀。
   ============================================================ */
'use strict';
const store = require('./store');

const MAX = 2000;

function audit(me, action, target, meta) {
  const db = store.get();
  if (!Array.isArray(db.auditLog)) db.auditLog = [];
  db.auditLog.unshift({
    id: 'A' + Date.now().toString(36),
    at: new Date().toISOString(),
    staffId: me ? me.staffId : null,
    email: me ? me.email : null,
    action, target: target || null, meta: meta || null,
    ip: null,
  });
  /* 超出上限从尾部裁掉。unshift 到头部意味着裁掉的是最旧的那些，
     而这正是我们愿意放弃的部分。 */
  if (db.auditLog.length > MAX) db.auditLog.length = MAX;
}

module.exports = { audit, MAX };
