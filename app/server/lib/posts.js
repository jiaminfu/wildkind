/* ============================================================
   LASTGROVE · 博客数据层
   ------------------------------------------------------------
   读写 db.posts 的唯一入口。路由层不直接碰数组，
   因为下面这几件事必须每次都做对，漏一次就是脏数据：

     1) 块白名单过滤 —— 未知类型静默丢弃，脏数据不该让整页 500
     2) slug 唯一化 —— 冲突时自动加 -2，而不是让两篇文章抢同一个 URL
     3) postsRev 递增 —— 预渲染缓存靠它整体失效
     4) 阅读时长重算 —— 只在写入时算，渲染时不再遍历全文

   公开读取一律硬过滤 status === 'published'。
   草稿对外必须表现为「不存在」，而不是「这是一篇草稿」——
   后者等于告诉外人，这里有一篇还没写完的东西。
   ============================================================ */
'use strict';
const store = require('./store');
const R = require('../../web/assets/js/blog-render');
const { ApiError } = require('./http');

const DEFAULT_LIMIT = 9;
const MAX_LIMIT = 24;

function db() { return store.get(); }

/* 每个写操作都要走一次。不 ++ 的话，运营点了发布刷新还是旧页面，
   第一反应是「你的系统坏了」。 */
function bumpRev(d) {
  d.meta = d.meta || {};
  d.meta.postsRev = (Number(d.meta.postsRev) || 1) + 1;
}

function nowIso() { return new Date().toISOString(); }

/* id 与既有惯例一致：'P' + base36 时间戳。
   同一毫秒内连建两篇会撞，加个随机尾数 —— 撞了的表现是后一篇覆盖前一篇。 */
function newId() {
  return 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
}

/* ---------------- slug ---------------- */
function slugify(title) {
  return String(title == null ? '' : title)
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // café → cafe
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

function slugTaken(slug, exceptId) {
  return db().posts.some(p => p.slug === slug && p.id !== exceptId);
}

function uniqueSlug(base, exceptId) {
  let seed = slugify(base);
  /* 中文标题 slugify 之后会变成空串。不能直接抛错让运营去手填拼音 ——
     给一个可用的默认值，他在后台改就是了。 */
  if (!seed || seed.length < 3) seed = 'journal-' + Date.now().toString(36);
  let slug = seed;
  let n = 2;
  while (slugTaken(slug, exceptId)) {
    slug = seed.replace(/-\d+$/, '') + '-' + n;
    n++;
    if (n > 200) { slug = seed + '-' + Date.now().toString(36); break; }
  }
  return slug;
}

/* ---------------- 块过滤 ----------------
   返回干净数组。非法块默默丢掉而不是抛错：
   历史数据脏了（改过版本、手工改过 JSON）不该让整篇文章打不开。
   但「全丢光」要单独判 —— 那通常是前端表单出 bug 了。 */
function normalizeBlocks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const type = String(raw.type || '');
    if (R.BLOCK_TYPES.indexOf(type) < 0) continue;

    if (type === 'image') {
      const src = String(raw.src || '');
      /* 只收站内上传目录。外链图片既不可控也不该进 CMS：
         运营贴一个外部地址，半年后对方删图，文章就空了。 */
      if (src.indexOf('/uploads/') !== 0) continue;
      out.push({
        type: 'image',
        src,
        alt: String(raw.alt || '').slice(0, R.limits.MAX_ALT),
        caption: String(raw.caption || '').slice(0, 200),
      });
      continue;
    }

    if (type === 'hr') { out.push({ type: 'hr' }); continue; }

    if (type === 'ul') {
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .slice(0, R.limits.MAX_ITEMS)
        .map(x => String(x == null ? '' : x).slice(0, R.limits.MAX_ITEM).trim())
        .filter(Boolean);
      if (!items.length) continue;
      out.push({ type: 'ul', items });
      continue;
    }

    const text = String(raw.text == null ? '' : raw.text).slice(0, R.limits.MAX_TEXT);
    if (!text.trim()) continue;
    const block = { type, text };
    if (type === 'quote' && raw.cite) block.cite = String(raw.cite).slice(0, 120);
    out.push(block);
  }
  return out.slice(0, R.limits.MAX_BLOCKS);
}

/* ---------------- 校验 ----------------
   所有错误都带 field，后台表单据此把红字标到具体那一行，
   而不是在页面顶部弹一句「保存失败」。 */
function bad(field, message) {
  return new ApiError(400, 'INVALID_POST', message, [{ field, message }]);
}

function sections() {
  const d = db();
  return (d.settings.postSections || []).slice();
}

function validate(input, opts) {
  opts = opts || {};
  const partial = !!opts.partial;
  const out = {};

  if (input.title !== undefined || !partial) {
    const title = String(input.title == null ? '' : input.title).trim();
    if (!title) throw bad('title', 'Title is required.');
    if (title.length > 90) throw bad('title', 'Title must be 90 characters or fewer.');
    out.title = title;
  }

  if (input.slug !== undefined) {
    const raw = String(input.slug || '').trim();
    if (raw) {
      const slug = slugify(raw);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
        throw bad('slug', 'Slug may only contain lowercase letters, numbers and single hyphens.');
      }
      if (slug.length < 3 || slug.length > 80) {
        throw bad('slug', 'Slug must be between 3 and 80 characters.');
      }
      out.slug = slug;
    }
  }

  if (input.excerpt !== undefined) {
    const v = String(input.excerpt == null ? '' : input.excerpt).trim();
    if (v.length > 200) throw bad('excerpt', 'Excerpt must be 200 characters or fewer.');
    out.excerpt = v;
  }

  if (input.seoTitle !== undefined) {
    const v = String(input.seoTitle == null ? '' : input.seoTitle).trim();
    if (v.length > 70) throw bad('seoTitle', 'SEO title must be 70 characters or fewer.');
    out.seoTitle = v;
  }
  if (input.seoDescription !== undefined) {
    const v = String(input.seoDescription == null ? '' : input.seoDescription).trim();
    /* 比 excerpt 更严：搜索引擎一般在 158 字截断，超出的部分是白写的。 */
    if (v.length > 158) throw bad('seoDescription', 'SEO description must be 158 characters or fewer.');
    out.seoDescription = v;
  }

  if (input.section !== undefined) {
    const v = String(input.section || '').trim();
    if (v && sections().indexOf(v) < 0) {
      throw bad('section', 'Unknown section "' + v + '". Allowed: ' + sections().join(', ') + '.');
    }
    out.section = v || (sections()[0] || 'materials');
  }

  if (input.coverImage !== undefined) {
    const v = String(input.coverImage || '').trim();
    /* 封面允许为空（三篇旧文就没有素材），但填了就必须是站内上传。 */
    if (v && v.indexOf('/uploads/') !== 0) {
      throw bad('coverImage', 'Cover image must be uploaded to this site (/uploads/…).');
    }
    out.coverImage = v;
  }
  if (input.coverAlt !== undefined) {
    out.coverAlt = String(input.coverAlt || '').slice(0, R.limits.MAX_ALT);
  }

  if (input.blocks !== undefined) {
    const cleaned = normalizeBlocks(input.blocks);
    /* 传了非空数组却一块都没活下来 = 前端表单坏了。
       静默保存成空文章比报错更糟：运营以为存上了，第二天发现文章是白的。 */
    if (Array.isArray(input.blocks) && input.blocks.length && !cleaned.length) {
      throw bad('blocks', 'No valid blocks in the submitted body.');
    }
    out.blocks = cleaned;
  }

  if (input.status !== undefined) {
    const v = String(input.status || '');
    if (['draft', 'published'].indexOf(v) < 0) throw bad('status', 'Status must be draft or published.');
    out.status = v;
  }

  if (input.cta !== undefined) {
    const cta = input.cta || {};
    const label = String(cta.label || '').trim().slice(0, 60);
    const href = String(cta.href || '').trim().slice(0, 300);
    if (label && href && !R.safeUrl(href)) {
      throw bad('cta', 'CTA link must be a site path (/…) or an http(s) URL.');
    }
    out.cta = label && href ? { label, href } : null;
  }

  if (input.relatedProduct !== undefined) {
    out.relatedProduct = String(input.relatedProduct || '').trim().slice(0, 120);
  }

  return out;
}

/* ---------------- 读取 ---------------- */
function shapePost(p, withBlocks) {
  const out = {
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt || '',
    section: p.section || '',
    coverImage: p.coverImage || '',
    coverAlt: p.coverAlt || '',
    status: p.status,
    publishedAt: p.publishedAt || null,
    updatedAt: p.updatedAt || null,
    readMinutes: Number(p.readMinutes) || 1,
    seoTitle: p.seoTitle || '',
    seoDescription: p.seoDescription || '',
    cta: p.cta || null,
    relatedProduct: p.relatedProduct || '',
  };
  if (withBlocks) out.blocks = p.blocks || [];
  else out.blockCount = (p.blocks || []).length;
  return out;
}

function publishedSorted() {
  return db().posts
    .filter(p => p.status === 'published')
    .slice()
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

/* 公开列表。不返 blocks —— 一篇 30 KB 的正文乘 9 就是 270 KB，
   而列表页一个字的正文都不显示。 */
function listPublic(q) {
  q = q || {};
  let list = publishedSorted();
  const section = String(q.section || '').trim();
  /* 未知栏目返回空列表而不是 400：栏目是 URL 参数，
     有人手改地址栏不该看到一个报错页。 */
  if (section) list = list.filter(p => p.section === section);

  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit, 10) || DEFAULT_LIMIT));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  const start = (page - 1) * limit;

  const items = list.slice(start, start + limit).map(p => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt || '',
    section: p.section || '',
    coverImage: p.coverImage || '',
    coverAlt: p.coverAlt || '',
    publishedAt: p.publishedAt || null,
    readMinutes: Number(p.readMinutes) || 1,
  }));

  return {
    items,
    meta: {
      page, limit, total,
      pages,
      hasMore: start + items.length < total,
      sections: sections(),
    },
  };
}

/* 公开详情。草稿与不存在返回完全同一种 404 —— 文案也必须一样。 */
function getPublic(slug) {
  const p = db().posts.find(x => x.slug === slug && x.status === 'published');
  if (!p) return null;

  const all = publishedSorted();
  const i = all.findIndex(x => x.id === p.id);
  const out = shapePost(p, true);
  out.prev = i > 0 ? { slug: all[i - 1].slug, title: all[i - 1].title } : null;
  out.next = i >= 0 && i < all.length - 1 ? { slug: all[i + 1].slug, title: all[i + 1].title } : null;
  return out;
}

/* ---------------- 后台 ---------------- */
function listAdmin(q) {
  q = q || {};
  const status = String(q.status || '').trim();
  let list = db().posts.slice();
  if (status) list = list.filter(p => p.status === status);
  list.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 50));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.max(1, parseInt(q.page, 10) || 1));
  const start = (page - 1) * limit;

  return {
    items: list.slice(start, start + limit).map(p => shapePost(p, false)),
    meta: { page, limit, total, pages, sections: sections() },
  };
}

function getAdmin(id) {
  const p = db().posts.find(x => x.id === id);
  return p ? shapePost(p, true) : null;
}

/* ---------------- 写入 ---------------- */
function create(input, me) {
  const body = validate(input, { partial: false });
  const d = db();

  const post = {
    id: newId(),
    slug: uniqueSlug(body.slug || body.title, null),
    title: body.title,
    excerpt: body.excerpt || '',
    coverImage: body.coverImage || '',
    coverAlt: body.coverAlt || '',
    section: body.section || sections()[0] || 'materials',
    blocks: body.blocks || [],
    status: body.status || 'draft',
    publishedAt: null,
    updatedAt: nowIso(),
    createdAt: nowIso(),
    seoTitle: body.seoTitle || '',
    seoDescription: body.seoDescription || '',
    cta: body.cta || null,
    relatedProduct: body.relatedProduct || '',
    readMinutes: R.readMinutes(body.blocks || []),
  };

  /* 直接建成 published 的文章（后台有「Publish」按钮，可以一步到位）
     必须有发布时间，否则列表按 publishedAt 排序时它会沉到底部。 */
  if (post.status === 'published') post.publishedAt = nowIso();

  d.posts.push(post);
  bumpRev(d);
  return shapePost(post, true);
}

function update(id, input, me) {
  const d = db();
  const post = d.posts.find(x => x.id === id);
  if (!post) return null;

  const body = validate(input, { partial: true });

  if (body.slug !== undefined && body.slug !== post.slug) {
    /* 改 slug 等于改 URL。老地址会 404，已收录的链接全废。
       这里不阻止（运营确实可能需要纠正拼写），但要在后台明确提示。 */
    post.slug = uniqueSlug(body.slug, post.id);
  }

  ['title', 'excerpt', 'coverImage', 'coverAlt', 'section', 'seoTitle', 'seoDescription',
    'relatedProduct'].forEach(k => {
    if (body[k] !== undefined) post[k] = body[k];
  });
  if (body.cta !== undefined) post.cta = body.cta;
  if (body.blocks !== undefined) {
    post.blocks = body.blocks;
    post.readMinutes = R.readMinutes(body.blocks);
  }

  if (body.status !== undefined && body.status !== post.status) {
    /* 从草稿转为发布时补发布时间；从发布退回草稿时保留原时间，
       下次再发布不用重新排期，也不会在列表里跳到顶部。 */
    if (body.status === 'published' && !post.publishedAt) post.publishedAt = nowIso();
    post.status = body.status;
  }

  post.updatedAt = nowIso();
  bumpRev(d);
  return shapePost(post, true);
}

function remove(id) {
  const d = db();
  const i = d.posts.findIndex(x => x.id === id);
  if (i < 0) return null;
  const gone = d.posts.splice(i, 1)[0];
  bumpRev(d);
  return shapePost(gone, false);
}

module.exports = {
  // 读
  listPublic, getPublic, listAdmin, getAdmin, sections, publishedSorted,
  // 写
  create, update, remove,
  // 工具（路由与测试共用）
  slugify, uniqueSlug, normalizeBlocks, validate, shapePost,
  DEFAULT_LIMIT, MAX_LIMIT,
};
