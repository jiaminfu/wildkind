/* 临时后端验证脚本（跑完即删）：覆盖商品增删改、上传、上下架拦截、CSV 导入 */
const BASE = 'http://127.0.0.1:4610';
let TOK = '';
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); }
}

async function req(method, path, body, token, raw) {
  const r = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: r.status, text: await r.text() };
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  await req('POST', '/api/v1/__test/reset');
  const login = await req('POST', '/api/v1/admin/login', { email: 'owner@tideglassjewelry.com', password: 'tideglass2026' });
  TOK = login.data && login.data.token;
  ok('owner 登录', !!TOK);

  // 1 新建（无图）
  const created = await req('POST', '/api/v1/admin/products', {
    title: 'Probe Hare', cat: 'necklaces', price: 76, cost: 19.5, desc: 'probe',
    variants: [{ metal: 'Gold', stock: 11 }, { metal: 'Silver', stock: 10 }],
    sizes: ['16in', '18'], motif: 'hare', set: 'woodland', badge: 'New',
  }, TOK);
  ok('新建返回 201', created.status === 201, created);
  const p = created.data && created.data.product;
  const NEW = p && p.id;
  ok('id 从最大编号 +1', p && p.id === 'TG-803', p && p.id);
  ok('handle 自动生成', p && p.handle === 'probe-hare', p && p.handle);
  ok('默认草稿', p && p.active === false);
  ok('库存汇总 = 11+10', p && p.stock === 21, p && p.stock);
  ok('尺码 16in → 16"', p && p.sizes && p.sizes[0] === '16"', p && p.sizes);
  ok('SKU 自动生成', p && p.variants[0].sku === 'TG-803-GO', p && p.variants);

  // 2 无图上架被拦
  const pub = await req('PATCH', '/api/v1/admin/products/' + NEW, { active: true }, TOK);
  ok('无图上架被拒 422', pub.status === 422 && pub.error.code === 'NEEDS_IMAGE', pub);

  // 3 校验规则
  const badCost = await req('PATCH', '/api/v1/admin/products/' + NEW, { cost: 200 }, TOK);
  ok('成本高于售价被拒', badCost.status === 422, badCost);
  const badMetal = await req('PATCH', '/api/v1/admin/products/' + NEW, { variants: [{ metal: 'gold plated', stock: 1 }] }, TOK);
  ok('非法金属被拒 400', badMetal.status === 400 && /metal/i.test(JSON.stringify(badMetal.error)), badMetal);
  const badCat = await req('POST', '/api/v1/admin/products', { title: 'X', cat: 'socks', price: 10, variants: [{ metal: 'Gold', stock: 1 }] }, TOK);
  ok('非法品类被拒', badCat.status === 400, badCat);

  // 4 上传
  const up = await req('POST', '/api/v1/admin/uploads', { dataUrl: PNG }, TOK);
  ok('上传返回 201', up.status === 201, up);
  ok('返回 uploads/ 路径', up.data && /^uploads\/p-/.test(up.data.path), up.data && up.data.path);
  const imgUrl = BASE + '/' + (up.data && up.data.path);
  const imgRes = await fetch(imgUrl);
  ok('图片可直接访问 200', imgRes.status === 200, imgRes.status);
  ok('内容类型 image/png', imgRes.headers.get('content-type') === 'image/png');
  const badUp = await req('POST', '/api/v1/admin/uploads', { dataUrl: 'data:image/png;base64,aGVsbG8=' }, TOK);
  ok('非图片内容被拒', badUp.status === 400, badUp);

  // 5 上传后上架
  const withImg = await req('PATCH', '/api/v1/admin/products/' + NEW, { images: [up.data.path], active: true }, TOK);
  ok('带图可上架', withImg.status === 200 && withImg.data.product.active === true, withImg);
  const pub2 = await req('GET', '/api/v1/products/probe-hare');
  ok('前台能查到已上架商品', pub2.status === 200 && pub2.data.product.id === NEW, pub2.status);

  // 6 改价带动变体比例
  const reprice = await req('PATCH', '/api/v1/admin/products/' + NEW, { price: 80 }, TOK);
  ok('改价后变体按比例', reprice.status === 200 && reprice.data.product.variants[0].price === 80, reprice.data && reprice.data.product.variants);

  // 7 复制
  const dup = await req('POST', '/api/v1/admin/products/' + NEW + '/duplicate', {}, TOK);
  ok('复制返回 201', dup.status === 201, dup);
  ok('复制件库存归零', dup.data && dup.data.product.stock === 0, dup.data && dup.data.product.stock);
  ok('复制件为草稿', dup.data && dup.data.product.active === false);
  const DUP = dup.data && dup.data.product.id;

  // 8 ops 权限边界
  const opsLogin = await req('POST', '/api/v1/admin/login', { email: 'ops@tideglassjewelry.com', password: 'tideglass-ops' });
  if (opsLogin.data && opsLogin.data.token) {
    const list = await req('GET', '/api/v1/admin/products?q=probe', null, opsLogin.data.token);
    const row = (list.data || [])[0];
    ok('ops 列表 cost 为 null', row && row.cost === null, row && row.cost);
    const opsPrice = await req('PATCH', '/api/v1/admin/products/' + NEW, { price: 79 }, opsLogin.data.token);
    ok('ops 可改价', opsPrice.status === 200, opsPrice.status);
    ok('ops 写返回不含 cost', opsPrice.data && opsPrice.data.product.cost === null, opsPrice.data && opsPrice.data.product.cost);
    const opsCost = await req('PATCH', '/api/v1/admin/products/' + NEW, { cost: 1 }, opsLogin.data.token);
    ok('ops 改成本被拒 403', opsCost.status === 403, opsCost);
    const opsSet = await req('PATCH', '/api/v1/admin/settings', { lowStockThreshold: 3 }, opsLogin.data.token);
    ok('ops 改设置 403', opsSet.status === 403, opsSet.status);
  } else {
    ok('ops 登录', false, opsLogin);
  }

  // 9 删除
  const del = await req('DELETE', '/api/v1/admin/products/' + DUP, null, TOK);
  ok('删除无订单商品成功', del.status === 200, del);
  const delUsed = await req('DELETE', '/api/v1/admin/products/TG-102', null, TOK);
  ok('删除有订单商品被拒 409', delUsed.status === 409, delUsed);

  // 10 CSV 导入
  const csvText = [
    'group,title,handle,category,price,cost,metal,stock,variantPrice,desc,collections,sizes',
    'clover-bracelet,Clover Bracelet,,bracelets,48,12,Gold,7,52,Four leaf,bracelets,7in',
    'clover-bracelet,Clover Bracelet,,bracelets,48,12,Silver,5,,Four leaf,bracelets,7in',
    'bad-row,Broken Item,,bracelets,-3,1,Gold,2,,, ,',
  ].join('\n');
  const prev = await req('POST', '/api/v1/admin/products/import/preview', { csv: csvText }, TOK);
  ok('预检返回 2 组', prev.status === 200 && prev.data.groupCount === 2, prev.data && prev.data.groupCount);
  ok('预检抓到错误', prev.data.errorCount >= 1, prev.data && prev.data.errors);
  const beforeAll = await req('GET', '/api/v1/admin/products', null, TOK);
  const countBefore = (beforeAll.data || []).length;
  const blocked = await req('POST', '/api/v1/admin/products/import', { csv: csvText, mode: 'abort' }, TOK);
  ok('有错时 abort 模式拒绝', blocked.status === 422, blocked.status);
  const afterAll = await req('GET', '/api/v1/admin/products', null, TOK);
  ok('拒绝时库中无新增', (afterAll.data || []).length === countBefore, [(afterAll.data || []).length, countBefore]);
  const imported = await req('POST', '/api/v1/admin/products/import', { csv: csvText, mode: 'valid-only' }, TOK);
  ok('valid-only 导入 1 款', imported.status === 201 && imported.data.created === 1, imported.data);
  ok('导入后 2 个变体', imported.data.products[0].variants === 2, imported.data.products[0]);
  const tpl = await req('GET', '/api/v1/admin/products/import/template', null, TOK, true);
  ok('模板可下载', tpl.status === 200 && tpl.text.indexOf('group,title') >= 0,
    tpl.status + ' | ' + String(tpl.text || '').slice(0, 30));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
