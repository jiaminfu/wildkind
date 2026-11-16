/* ============================================================
   LASTGROVE · 后台文章列表与分块编辑器
   ------------------------------------------------------------
   正文的存法是「块数组 + 块内轻量标记」（SDS D-5），不是 HTML、不是 Markdown。
   所以这里的编辑器也就是一块一块的 textarea：**粗**、*斜*、[文字](链接) 直接写在
   文字里，所见即标记。运营不需要学语法，也不会有一条「渲染后长什么样」和
   「存进去的是什么」之间的认知鸿沟 —— 那正是富文本编辑器最容易出问题的地方。

   块操作（上移/下移/删除/改类型）直接改 DOM，不重渲染整页：
   重渲染会丢焦点和没提交的输入，编辑到一半被吞掉一段话是最伤人的 bug。
   ============================================================ */
(function () {
  'use strict';
  var U = S.U;
  var B = window.BlogRender;

  var BLOCK_LABEL = {
    p: 'Paragraph', h2: 'Heading 2', h3: 'Heading 3',
    quote: 'Quote', ul: 'List', image: 'Image', hr: 'Divider'
  };

  function typeOpts(cur) {
    return Object.keys(BLOCK_LABEL).map(function (t) {
      return '<option value="' + t + '"' + (t === cur ? ' selected' : '') + '>' + BLOCK_LABEL[t] + '</option>';
    }).join('');
  }

  /* 单个块的 HTML。导出给块操作复用（改类型时只换这一块）。 */
  function blockHtml(b, i) {
    b = b || { type: 'p', text: '' };
    var t = b.type || 'p';
    var body = '';

    if (t === 'hr') {
      body = '<div class="blk__empty">A horizontal rule.</div>';
    } else if (t === 'image') {
      body = '<div class="blk__row">' +
        '<label class="afld"><span>Image path</span>' +
        '<input name="bsrc" value="' + U.esc(b.src || '') + '" placeholder="/uploads/…" readonly></label>' +
        '<button class="abtn sm" type="button" data-act="blk-img">Choose image</button>' +
        '</div>' +
        '<label class="afld"><span>Alt text (screen readers and SEO)</span>' +
        '<input name="balt" value="' + U.esc(b.alt || '') + '" maxlength="200"></label>' +
        '<label class="afld"><span>Caption (optional)</span>' +
        '<input name="bcap" value="' + U.esc(b.caption || '') + '" maxlength="200"></label>' +
        (b.src ? '<div class="blk__prev"><img src="' + U.esc(b.src) + '" alt=""></div>' : '');
    } else if (t === 'ul') {
      body = '<textarea name="btext" rows="4" placeholder="One item per line">' +
        U.esc((b.items || []).join('\n')) + '</textarea>';
    } else {
      body = '<textarea name="btext" rows="' + (t === 'p' ? 4 : 2) + '" placeholder="' +
        (t === 'p' ? 'Write a paragraph. **bold**, *italic*, [link](/path)' : 'Heading text') + '">' +
        U.esc(b.text || '') + '</textarea>';
    }

    return '<div class="blk" data-type="' + t + '">' +
      '<div class="blk__hd">' +
      '<b class="blk__n">' + (i + 1) + '</b>' +
      '<select data-act="blk-type" aria-label="Block type">' + typeOpts(t) + '</select>' +
      '<span class="blk__sp"></span>' +
      '<button class="abtn sm" type="button" data-act="blk-up" aria-label="Move up">↑</button>' +
      '<button class="abtn sm" type="button" data-act="blk-down" aria-label="Move down">↓</button>' +
      '<button class="abtn sm" type="button" data-act="blk-del" aria-label="Delete block">✕</button>' +
      '</div>' + body + '</div>';
  }

  /* 块序号重排。改完 DOM 之后必须调一次，否则编辑器里显示的编号会错位，
     而编号是运营唯一能用来对齐「我刚才在说第几段」的锚点。 */
  function renumber(form) {
    var list = form.querySelectorAll('.blk');
    Array.prototype.forEach.call(list, function (el, i) {
      var n = el.querySelector('.blk__n');
      if (n) n.textContent = i + 1;
    });
  }

  /* 从 DOM 收块。列表块每一行一项；空行丢掉（粘贴带进来的空行很常见）。 */
  function collectBlocks(form) {
    return Array.prototype.map.call(form.querySelectorAll('.blk'), function (el) {
      var t = el.getAttribute('data-type');
      if (t === 'hr') return { type: 'hr' };
      if (t === 'image') {
        var src = (el.querySelector('[name=bsrc]') || {}).value || '';
        return {
          type: 'image',
          src: src.trim(),
          alt: ((el.querySelector('[name=balt]') || {}).value || '').slice(0, 200),
          caption: ((el.querySelector('[name=bcap]') || {}).value || '').slice(0, 200),
        };
      }
      var ta = el.querySelector('textarea');
      var raw = ta ? ta.value : '';
      if (t === 'ul') {
        var items = raw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        return { type: 'ul', items: items };
      }
      return { type: t, text: raw };
    }).filter(function (b) {
      /* 空块不提交：一块空 textarea 会被服务端丢弃，前端也跟着丢，
         否则每保存一次就多几个「块数对不上」的疑惑。 */
      if (b.type === 'hr') return true;
      if (b.type === 'image') return !!b.src;
      if (b.type === 'ul') return b.items.length > 0;
      return !!String(b.text || '').trim();
    });
  }

  /* ---------------- 列表 ---------------- */
  function list(items, meta, query) {
    var st = (query && query.status) || '';
    var tab = function (v, label) {
      return '<a class="abtn sm' + (st === v ? ' is-on' : '') + '" href="/#/admin/articles' +
        (v ? '?status=' + v : '') + '">' + label + '</a>';
    };

    var rows = (items || []).map(function (p) {
      var pub = p.publishedAt ? B.isoDate(p.publishedAt) : '—';
      var upd = p.updatedAt ? B.isoDate(p.updatedAt) : '—';
      return '<tr>' +
        '<td><a href="/#/admin/articles/' + U.esc(p.id) + '">' + U.esc(p.title) + '</a>' +
        '<div class="sub">/' + U.esc(p.slug) + '</div></td>' +
        '<td>' + U.esc(B.sectionLabel(p.section)) + '</td>' +
        '<td><span class="pill ' + (p.status === 'published' ? 'active' : 'draft') + '">' +
        (p.status === 'published' ? 'Published' : 'Draft') + '</span></td>' +
        '<td class="sub">' + pub + '</td>' +
        '<td class="sub">' + upd + '</td>' +
        '<td>' +
        '<a class="abtn sm" href="/journal/' + U.esc(p.slug) + '" target="_blank" rel="noopener">View</a>' +
        '<a class="abtn sm" href="/#/admin/articles/' + U.esc(p.id) + '">Edit</a>' +
        '</td></tr>';
    }).join('');

    return '<div class="panel"><div class="panel__hd"><h2>Articles</h2>' +
      '<div class="phd-r">' + tab('', 'All') + tab('published', 'Published') + tab('draft', 'Draft') +
      '<a class="btn sm" href="/#/admin/articles/new">+ New article</a></div></div>' +
      '<div class="panel__bd">' +
      ((items && items.length)
        ? '<table class="atable"><thead><tr><th>Title</th><th>Section</th><th>Status</th>' +
        '<th>Published</th><th>Updated</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="sub">No articles yet. ' +
        '<a href="/#/admin/articles/new">Write the first one</a>.</p>') +
      '</div></div>' +
      '<div class="panel__bd sub">Drafts are invisible to the public — their URL returns the same ' +
      '404 as a page that never existed. Publish when the copy is ready.</div>';
  }

  /* ---------------- 编辑器 ---------------- */
  function editor(p, sections) {
    var isNew = !p;
    p = p || { id: '', title: '', slug: '', excerpt: '', section: '', blocks: [], status: 'draft' };
    sections = sections && sections.length ? sections : ['materials', 'studio', 'giving', 'care'];
    var blocks = (p.blocks && p.blocks.length) ? p.blocks : [{ type: 'p', text: '' }];

    var secOpts = sections.map(function (s) {
      return '<option value="' + U.esc(s) + '"' + (s === p.section ? ' selected' : '') + '>' +
        U.esc(B.sectionLabel(s)) + '</option>';
    }).join('');

    return '<form data-act="post-save" data-id="' + U.esc(p.id) + '" class="postform">' +
      '<div class="panel"><div class="panel__hd"><h2>' + (isNew ? 'New article' : U.esc(p.title)) + '</h2>' +
      '<div class="phd-r">' +
      '<a class="abtn sm" href="/#/admin/articles">← All articles</a>' +
      (isNew ? '' : '<a class="abtn sm" href="/journal/' + U.esc(p.slug) + '" target="_blank" rel="noopener">View</a>') +
      '</div></div>' +
      '<div class="panel__bd cform">' +
      '<label class="afld afld--full"><span>Title</span>' +
      '<input name="title" value="' + U.esc(p.title) + '" maxlength="90" required></label>' +
      '<label class="afld afld--full"><span>Slug — the URL is /journal/<b class="slugprev">' +
      U.esc(p.slug || 'auto-from-title') + '</b></span>' +
      '<input name="slug" value="' + U.esc(p.slug) + '" maxlength="80" placeholder="Leave empty to derive from the title"></label>' +
      '<label class="afld afld--full"><span>Excerpt — shown on the list page and in search results</span>' +
      '<input name="excerpt" value="' + U.esc(p.excerpt) + '" maxlength="200"></label>' +
      '<label class="afld"><span>Section</span><select name="section">' + secOpts + '</select></label>' +
      '<label class="afld"><span>Cover image</span>' +
      '<input name="coverImage" value="' + U.esc(p.coverImage || '') + '" placeholder="/uploads/…" readonly></label>' +
      '<div class="afld"><span>Cover</span>' +
      '<button class="abtn sm" type="button" data-act="post-cover">Choose image</button>' +
      (p.coverImage ? '<button class="abtn sm" type="button" data-act="post-cover-clear">Remove</button>' : '') +
      '</div>' +
      '<div class="afld afld--full" data-role="coverprev">' +
      (p.coverImage ? '<img src="' + U.esc(p.coverImage) + '" alt="">' : '') + '</div>' +
      '<label class="afld afld--full"><span>Cover alt text</span>' +
      '<input name="coverAlt" value="' + U.esc(p.coverAlt || '') + '" maxlength="200"></label>' +
      '</div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>Body</h2>' +
      '<div class="phd-r"><select data-act="blk-add" aria-label="Add block">' +
      '<option value="">+ Insert block…</option>' +
      Object.keys(BLOCK_LABEL).map(function (t) {
        return '<option value="' + t + '">' + BLOCK_LABEL[t] + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="panel__bd"><div class="blklist" id="blkList">' +
      blocks.map(blockHtml).join('') +
      '</div><p class="sub">Formatting inside a block: <b>**bold**</b>, <i>*italic*</i>, ' +
      '[text](/path). No HTML — anything that looks like a tag is shown as text.</p></div></div>' +

      '<div class="panel"><div class="panel__hd"><h2>SEO and call to action</h2></div>' +
      '<div class="panel__bd cform">' +
      '<label class="afld afld--full"><span>SEO title — empty falls back to the article title</span>' +
      '<input name="seoTitle" value="' + U.esc(p.seoTitle || '') + '" maxlength="70"></label>' +
      '<label class="afld afld--full"><span>SEO description — max 158 characters, empty falls back to the excerpt</span>' +
      '<input name="seoDescription" value="' + U.esc(p.seoDescription || '') + '" maxlength="158"></label>' +
      '<label class="afld"><span>CTA label (optional)</span>' +
      '<input name="ctaLabel" value="' + U.esc((p.cta && p.cta.label) || '') + '" maxlength="60"></label>' +
      '<label class="afld"><span>CTA link</span>' +
      '<input name="ctaHref" value="' + U.esc((p.cta && p.cta.href) || '') + '" maxlength="300" placeholder="/#/collections/necklaces"></label>' +
      '</div></div>' +

      '<div class="panel"><div class="panel__bd postform__act">' +
      '<button class="btn" type="submit">Save</button>' +
      '<button class="abtn" type="button" data-act="post-publish">' +
      (p.status === 'published' ? 'Unpublish' : 'Publish') + '</button>' +
      '<span class="sub" data-role="dirty"></span>' +
      (isNew ? '' : '<button class="abtn danger" type="button" data-act="post-delete" ' +
        'data-title="' + U.esc(p.title) + '">Delete</button>') +
      '</div></div>' +
      '</form>';
  }

  window.BlogAdmin = {
    list: list, editor: editor,
    blockHtml: blockHtml, renumber: renumber, collectBlocks: collectBlocks,
    BLOCK_LABEL: BLOCK_LABEL,
  };
})();
