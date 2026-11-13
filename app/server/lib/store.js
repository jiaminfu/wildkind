/* ============================================================
   TIDEGLASS · 数据层
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
  if (!Array.isArray(d.customRequests)) d.customRequests = [];
  if (!d.sequences) d.sequences = {};
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

/* 原子写：先写临时文件再 rename，避免进程被杀时留下半个 JSON */
function flush() {
  if (!db) return Promise.resolve();
  const snapshot = JSON.stringify(db, null, 1);
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    const tmp = FILE + '.tmp';
    fs.writeFile(tmp, snapshot, 'utf8', err => {
      if (err) return reject(err);
      fs.rename(tmp, FILE, e2 => (e2 ? reject(e2) : resolve()));
    });
  }));
  return writeQueue;
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

module.exports = { get, load, reload, flush, tx, DATA_DIR, FILE, isReady };
