/* ============================================================
   TIDEGLASS · 图片落地
   商品图存数据卷里的 data/uploads/，跟 db.json 同一个卷，
   容器重建不丢。对外通过 /uploads/<file> 读取（见 index.js）。
   零第三方依赖：base64 解码用 Buffer，类型判断看文件头。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { ApiError } = require('./http');

const DIR = path.join(store.DATA_DIR, 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;      // 单张 5 MB（前端已压到 200~400 KB，留足余量）
const MAX_PER_PRODUCT = 6;
const ORPHAN_HOURS = 24;

const EXT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function ensure() {
  fs.mkdirSync(DIR, { recursive: true });
}

/* 只认文件头，不信扩展名也不信 content-type。
   改后缀的可执行文件、塞了脚本的 SVG 都在这一步被挡掉——
   后者尤其要紧：SVG 走 <img> 时不能执行脚本，但只要有人直接打开链接就是 XSS。 */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' &&
      buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function rand(n) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* 输入形如 "data:image/jpeg;base64,...."；返回可直接写进 product.images 的路径 */
function saveDataUrl(dataUrl) {
  const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new ApiError(400, 'INVALID_IMAGE', 'Unsupported image format. Use JPG, PNG or WebP.');

  const buf = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
  if (!buf.length) throw new ApiError(400, 'INVALID_IMAGE', 'Image is empty.');
  if (buf.length > MAX_BYTES) {
    throw new ApiError(413, 'IMAGE_TOO_LARGE',
      'Image is ' + (buf.length / 1048576).toFixed(1) + ' MB, limit is 5 MB.');
  }

  const ext = sniff(buf);
  if (!ext) throw new ApiError(400, 'INVALID_IMAGE', 'File content is not a JPG, PNG or WebP image.');

  ensure();
  const file = 'p-' + Date.now().toString(36) + '-' + rand(6) + '.' + ext;
  fs.writeFileSync(path.join(DIR, file), buf);
  return { path: 'uploads/' + file, file, bytes: buf.length, mime: EXT_MIME[ext] };
}

/* 目录穿越防护：文件名只允许安全字符，解析后必须仍在 DIR 内。
   /uploads/../../app/server/data/db.json 这种请求在这里被拒。 */
function resolve(name) {
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  const p = path.resolve(DIR, name);
  if (p !== path.join(DIR, name)) return null;
  if (!p.startsWith(DIR + path.sep)) return null;
  return p;
}

/* 商品保存失败、或用户中途放弃时，图已经落盘了。
   这些孤儿文件会越攒越多，每天清一次：只删没被任何商品引用、且超过 24 小时的。 */
function sweepOrphans(db) {
  ensure();
  const used = new Set();
  (db.products || []).forEach(p => (p.images || []).forEach(src => {
    const m = /^uploads\/(.+)$/.exec(String(src));
    if (m) used.add(m[1]);
  }));
  const cutoff = Date.now() - ORPHAN_HOURS * 3600 * 1000;
  let removed = 0;
  fs.readdirSync(DIR).forEach(name => {
    if (used.has(name)) return;
    const p = path.join(DIR, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(p); removed++; }
    } catch (e) { /* 并发删除，忽略 */ }
  });
  return removed;
}

function list() {
  ensure();
  return fs.readdirSync(DIR).filter(n => EXT_MIME[path.extname(n).slice(1).toLowerCase()]);
}

module.exports = {
  DIR, MAX_BYTES, MAX_PER_PRODUCT, EXT_MIME,
  ensure, sniff, saveDataUrl, resolve, sweepOrphans, list,
};
