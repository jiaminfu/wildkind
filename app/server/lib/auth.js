/* ============================================================
   TIDEGLASS · 后台鉴权
   角色只决定「默认给哪些权限位」，判断永远只看权限位（FRD 第 3 章）。
   密码用 scrypt + 随机盐，令牌 12 小时过期，落在 db.sessions 里可被吊销。
   ============================================================ */
'use strict';
const crypto = require('crypto');
const store = require('./store');
const { E } = require('./http');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const ALL_PERMISSIONS = [
  'metrics:read', 'orders:read', 'orders:write', 'orders:refund',
  'products:read', 'products:write', 'inventory:write',
  'customers:read', 'coupons:write', 'settings:write',
];

const ROLE_PRESETS = {
  owner: ALL_PERMISSIONS.slice(),
  ops: ['metrics:read', 'orders:read', 'orders:write', 'orders:refund',
    'products:read', 'products:write', 'inventory:write', 'customers:read', 'coupons:write'],
  support: ['orders:read', 'products:read', 'customers:read', 'metrics:read'],
};

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt: s, hash: h };
}

function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  // 定长比较，避免时序泄漏
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function issueToken(staffId, ip) {
  const db = store.get();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({
    token,
    staffId,
    ip: ip || '',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  // 顺手清掉过期会话，避免 sessions 无限增长
  const now = Date.now();
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt).getTime() > now);
  store.flush();
  return token;
}

function bearer(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+([a-f0-9]{16,})$/i.exec(h);
  return m ? m[1] : null;
}

/* 解析当前会话；未登录返回 null（不抛错，由 requireAuth 决定要不要拒） */
function current(req) {
  const token = bearer(req);
  if (!token) return null;
  const db = store.get();
  const sess = db.sessions.find(s => s.token === token);
  if (!sess) return null;
  if (new Date(sess.expiresAt).getTime() < Date.now()) return null;
  const staff = db.staff.find(s => s.id === sess.staffId);
  if (!staff || staff.status !== 'active') return null;
  return {
    staffId: staff.id,
    email: staff.email,
    name: staff.name,
    role: staff.role,
    permissions: staff.permissions || ROLE_PRESETS[staff.role] || [],
    token,
  };
}

function requireAuth(req) {
  const me = current(req);
  if (!me) throw E.unauthorized('Sign in to the admin to continue.');
  return me;
}

/* 权限位判断：只认 permissions，不认 role */
function requirePerm(me, perm) {
  if (me.permissions.indexOf(perm) < 0) {
    throw E.forbidden('Your account does not have "' + perm + '". Ask the store owner.');
  }
  return true;
}

function revoke(token) {
  const db = store.get();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter(s => s.token !== token);
  if (db.sessions.length !== before) store.flush();
}

module.exports = {
  ALL_PERMISSIONS, ROLE_PRESETS, hashPassword, verifyPassword,
  issueToken, current, requireAuth, requirePerm, revoke, TOKEN_TTL_MS,
};
