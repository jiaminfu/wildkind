/* ============================================================
   LASTGROVE · 数据层
   单文件 JSON 持久化 + 内存镜像 + 串行原子写。
   为什么不用数据库：本项目零第三方依赖（既定约束），
   36 SKU / 单写入场景下 JSON 足够；所有写操作串行，不会出现半写状态。
   上生产时这一层换成 PostgreSQL，接口签名保持不变（见 SDD 4.4）。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const DEFAULT_PAGES = require('./pages-default');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let db = null;
let writeQueue = Promise.resolve();
let dirty = false;

/* 启动时的轻量迁移：老数据文件里没有这些集合，代码升级后不能因为缺字段就报错。
   只在缺失时补，不覆盖已有值；补完留在内存里，下一次写操作自然落盘。 */
function normalize(d) {
  if (!d.pages || typeof d.pages !== 'object') {
    d.pages = JSON.parse(JSON.stringify(DEFAULT_PAGES));
  }
  /* 老库里 pages 还挂着 journal。博客迁到 /journal 真路径 + posts 表之后，
     这条键改了没有任何地方会读它 —— 留着只会让后台继续列一个假入口。
     只删这一个键，不动其他页；下一次写操作自然落盘。 */
  if (Object.prototype.hasOwnProperty.call(d.pages, 'journal')) delete d.pages.journal;
  if (!Array.isArray(d.customRequests)) d.customRequests = [];
  if (!d.sequences) d.sequences = {};

  /* ---------------- 博客 ----------------
     只在缺失时灌种子，不覆盖已有数据 —— 与 pages / customRequests 的迁移方式一致。
     三篇旧文现在就在前台 journal 页可见，迁移成草稿等于内容下线，是功能回退。 */
  if (!Array.isArray(d.posts)) d.posts = JSON.parse(JSON.stringify(require('./posts-default')));
  /* 阅读时长写入时算好，渲染时不再遍历全文。种子文件里手写的数字可能与
     正文实际长度对不上（改过文案就会对不上），这里统一重算一次。 */
  {
    const R = require('../../web/assets/js/blog-render');
    d.posts.forEach(p => {
      if (p && Array.isArray(p.blocks)) p.readMinutes = R.readMinutes(p.blocks);
    });
  }
  /* 栏目取值（SDS S-1）。后台可以增删，前台筛选只认这里列出的。
     不加这一层的话，运营建了一篇文章选错栏目，它就永远筛不出来。 */
  if (!Array.isArray(d.settings.postSections) || !d.settings.postSections.length) {
    d.settings.postSections = ['materials', 'studio', 'giving', 'care'];
  }
  /* postsRev 是预渲染缓存的版本号：任何写操作 ++ 一次，
     服务端整张缓存表随之作废。按 slug 精细失效在千级文章量下没有收益。 */
  if (!d.meta || typeof d.meta !== 'object') d.meta = {};
  if (typeof d.meta.postsRev !== 'number') d.meta.postsRev = 1;

  /* 销售税配置。默认关闭：没配税率之前一分钱税都不收，
     这是有意的 —— 错收税的代价（退款 + 客户投诉 + 各州申报口径不一）
     远大于晚收几天。后台打开开关并填好税率后才生效。 */
  if (!d.settings.tax || typeof d.settings.tax !== 'object') {
    d.settings.tax = { enabled: false, rates: {}, shipTaxable: true, note: '' };
  }
  if (!d.settings.tax.rates || typeof d.settings.tax.rates !== 'object') d.settings.tax.rates = {};
  if (typeof d.settings.tax.enabled !== 'boolean') d.settings.tax.enabled = false;
  if (typeof d.settings.tax.shipTaxable !== 'boolean') d.settings.tax.shipTaxable = true;

  /* 社交账号。默认全空 —— 页脚那几个图标在没有真实账号时指向「关于我们」，
     那是最坏的一种链接：点得开、但不是它说的那件事。
     现在改成「配了才显示」，没配就整块不渲染，不做假链接。 */
  if (!d.settings.socials || typeof d.settings.socials !== 'object' || Array.isArray(d.settings.socials)) {
    d.settings.socials = {};
  }
  ['instagram', 'pinterest', 'tiktok'].forEach(k => {
    const v = d.settings.socials[k];
    d.settings.socials[k] = (typeof v === 'string' && /^https?:\/\//i.test(v)) ? v.slice(0, 200) : '';
  });

  return d;
}

function load() {
  const raw = fs.readFileSync(FILE, 'utf8');
  db = normalize(JSON.parse(raw));
  return db;
}

function get() {
  if (!db) load();
  return db;
}

/* 原子写：先写临时文件再 rename，避免进程被杀时留下半个 JSON。

   ⚠️ 这里踩过一个能把数据全丢光的坑：
   `writeQueue = writeQueue.then(...)` 一旦某次写失败（磁盘满、.tmp 被别的进程占着、
   rename 跨设备），这个 promise 就变成 rejected，而**后续每一次 .then 都会被跳过**。
   于是进程照常跑、接口照常返回 200、内存里的数据全都对 —— 只有文件永远停在失败那一刻。
   实测表现：下了 3 单、退了 1 单，db.json 的修改时间一动不动，重启后全部消失。

   两个修法缺一不可：
   ① 每次拼接前先 `.catch(() => {})`，把链条拉回 resolved 状态，否则一次失败永久卡死；
   ② 失败必须留下痕迹（lastWriteError + 日志 + 健康检查），不能让它「看起来在正常写」。 */
let lastWriteError = null;

function flush() {
  if (!db) return Promise.resolve();
  const snapshot = JSON.stringify(db, null, 1);
  writeQueue = writeQueue.catch(() => {}).then(() => new Promise((resolve, reject) => {
    const tmp = FILE + '.tmp';
    fs.writeFile(tmp, snapshot, 'utf8', err => {
      if (err) return reject(err);
      fs.rename(tmp, FILE, e2 => (e2 ? reject(e2) : resolve()));
    });
  }));
  writeQueue = writeQueue.then(() => {
    lastWriteError = null;
  }, e => {
    lastWriteError = { at: new Date().toISOString(), message: String((e && e.message) || e) };
    console.error('[store] 写盘失败，本次快照未落盘：', (e && e.message) || e);
  });
  return writeQueue;
}

function writeHealth() {
  return { ok: !lastWriteError, lastWriteError: lastWriteError, pending: false };
}

/* 从磁盘重新装载内存镜像。
   用途只有两个：自动化测试在开跑前回到基线；运维手工修完 JSON 后热加载。
   正常业务流不调用——所有写操作都走 flush()。 */
function reload() {
  writeQueue = Promise.resolve();   // 丢弃未完成的写，避免旧快照覆盖新文件
  return load();
}

/* 事务：fn 内抛错则回滚到调用前的快照。
   单进程内有效——这也是「上生产换 DB」的边界之一。 */
function tx(fn) {
  const snapshot = JSON.stringify(db);
  try {
    const result = fn(db);
    flush();
    return result;
  } catch (e) {
    db = JSON.parse(snapshot);
    throw e;
  }
}

function isReady() { return !!db; }
function markDirty() { dirty = true; }
function isDirty() { return dirty; }

module.exports = { get, load, reload, flush, tx, DATA_DIR, FILE, isReady, writeHealth };
