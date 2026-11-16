/* ============================================================
   LASTGROVE API · 员工账号（后台加人 / 改权 / 停用 / 删除）
   用法：node tools/api-test-staff.js [baseUrl]

   独立于 api-test.js，因为这套用例会真的建账号、改角色、删账号。
   开跑前复位到基线、跑完再复位一次 —— 这样任何中途失败都不会在库里
   留下垃圾账号（上一版没这么做，结果一条断言失败就把 owner 降成了 ops，
   下一轮所有接口 403，查了半天才发现是测试自己改的数据）。
   ============================================================ */
'use strict';
const BASE = process.argv[2] || 'http://localhost:4600';

const OWNER = { email: 'owner@lastgrove.com', password: 'lastgrove2026' };
const STAMP = Date.now().toString(36);
const TMP_A = 'staff-a-' + STAMP + '@example.com';
const TMP_B = 'staff-b-' + STAMP + '@example.com';
const TMP_C = 'staff-c-' + STAMP + '@example.com';

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
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function resetData() {
  return call('POST', '/api/v1/__test/reset');
}

(async () => {
  let aborted = false;

  /* ---------- 0. 复位 ---------- */
  section('0 复位到基线');
  const r0 = await resetData();
  if (r0.status !== 200) {
    console.log('  ⚠️  服务未开启复位端点（需 ALLOW_TEST_RESET=1 启动）。' +
      '这套用例依赖「基线只有一个 owner」，否则护栏断言不成立 —— 已中止。');
    process.exit(2);
  }
  chk('已复位', true, r0.body.data.orders + ' 单');

  try {
    /* ---------- 1. 登录 ---------- */
    section('1 登录与权限可见性');
    const login = await call('POST', '/api/v1/admin/login', OWNER);
    chk('owner 登录 200', login.status === 200,
      login.body && login.body.error && login.body.error.message);
    const owner = 'Bearer ' + (login.body.data.token || '');
    chk('owner 权限含 staff:write',
      (login.body.data.staff.permissions || []).indexOf('staff:write') >= 0,
      (login.body.data.staff.permissions || []).length + ' 个权限位');

    /* owner 的权限是「恒为全量」，不依赖库里那份可能漏位的旧数组 */
    const me = await call('GET', '/api/v1/admin/me', undefined, { Authorization: owner });
    chk('/admin/me 同样含 staff:read',
      (me.body.data.staff.permissions || []).indexOf('staff:read') >= 0);

    /* ---------- 2. 列表 ---------- */
    section('2 员工列表');
    const list = await call('GET', '/api/v1/admin/staff', undefined, { Authorization: owner });
    chk('列表 200', list.status === 200);
    chk('返回三档角色预置', (list.body.data.roles || []).length === 3,
      (list.body.data.roles || []).map(r => r.role).join('/'));
    chk('owner 排在第一位', (list.body.data.staff || [])[0].role === 'owner');
    const row0 = (list.body.data.staff || [])[0] || {};
    chk('不泄漏 salt', row0.salt === undefined);
    chk('不泄漏 hash', row0.hash === undefined);
    chk('带 me 标记', list.body.data.me === row0.id, list.body.data.me);
    chk('基线只有一个 owner',
      (list.body.data.staff || []).filter(s => s.role === 'owner' && s.status === 'active').length === 1);
    const myId = list.body.data.me;

    /* ---------- 3. 建账号 ---------- */
    section('3 创建账号');
    const bad = await call('POST', '/api/v1/admin/staff',
      { email: 'not-an-email', name: 'X Y', role: 'support', password: 'longenough1' },
      { Authorization: owner });
    chk('邮箱格式不合法被拒', bad.status === 400, bad.body.error && bad.body.error.code);

    const short = await call('POST', '/api/v1/admin/staff',
      { email: TMP_A, name: 'Temp A', role: 'support', password: '123' }, { Authorization: owner });
    chk('密码短于 8 位被拒', short.status === 400, short.body.error && short.body.error.message);

    const badRole = await call('POST', '/api/v1/admin/staff',
      { email: TMP_A, name: 'Temp A', role: 'admin', password: 'longenough1' }, { Authorization: owner });
    chk('未知角色被拒', badRole.status === 400, badRole.body.error && badRole.body.error.message);

    const a = await call('POST', '/api/v1/admin/staff',
      { name: 'Temp A', email: TMP_A, role: 'support', password: 'temp-pass-a' },
      { Authorization: owner });
    chk('建 support 账号 201', a.status === 201, a.status);
    chk('按角色预置权限（support 无退款权）',
      a.body.data.staff.permissions.indexOf('orders:refund') < 0,
      a.body.data.staff.permissions.join(','));
    chk('新账号默认 active', a.body.data.staff.status === 'active');

    const dup = await call('POST', '/api/v1/admin/staff',
      { name: 'Temp A2', email: TMP_A.toUpperCase(), role: 'support', password: 'temp-pass-a' },
      { Authorization: owner });
    chk('同邮箱（大小写不同）也拒', dup.status === 409, dup.body.error && dup.body.error.code);

    const b = await call('POST', '/api/v1/admin/staff',
      { name: 'Temp B', email: TMP_B, role: 'ops', password: 'temp-pass-b' }, { Authorization: owner });
    chk('建 ops 账号 201', b.status === 201);
    const bId = b.body.data.staff.id;

    /* ---------- 4. 权限位真的生效 ---------- */
    section('4 新账号能登录、权限按位生效');
    const bLogin = await call('POST', '/api/v1/admin/login', { email: TMP_B, password: 'temp-pass-b' });
    chk('新账号可登录', bLogin.status === 200, bLogin.status);
    const opsTok = 'Bearer ' + (bLogin.body.data.token || '');

    const opsSettings = await call('PATCH', '/api/v1/admin/settings', { freeShip: 150 },
      { Authorization: opsTok });
    chk('ops 改设置被拒 403', opsSettings.status === 403, opsSettings.body.error && opsSettings.body.error.code);

    const opsStaff = await call('GET', '/api/v1/admin/staff', undefined, { Authorization: opsTok });
    chk('ops 看员工列表被拒 403', opsStaff.status === 403,
      opsStaff.body.error && opsStaff.body.error.message);

    const opsOrders = await call('GET', '/api/v1/admin/orders', undefined, { Authorization: opsTok });
    chk('ops 看订单仍然可以', opsOrders.status === 200, opsOrders.status);

    /* ---------- 5. 改角色 ---------- */
    section('5 改角色要把权限一起改掉');
    const demote = await call('PATCH', '/api/v1/admin/staff/' + bId,
      { role: 'support' }, { Authorization: owner });
    chk('降到 support 200', demote.status === 200, demote.status);
    /* 这里曾经有真 bug：库里那份旧权限数组优先级高于角色预置，
       于是「降成 support」只改了显示，一按退款还是能退。 */
    chk('权限跟着角色重置为只读',
      demote.body.data.staff.permissions.indexOf('orders:write') < 0,
      demote.body.data.staff.permissions.join(','));

    /* 权限每次请求现读库，不需要重新登录 */
    const bAfter = await call('POST', '/api/v1/admin/products',
      { title: 'should-not-be-created' }, { Authorization: opsTok });
    chk('旧令牌立即失去 products:write（403）', bAfter.status === 403, bAfter.status);

    const custom = await call('PATCH', '/api/v1/admin/staff/' + bId,
      { permissions: ['orders:read', 'no:such:perm'] }, { Authorization: owner });
    chk('自定义权限只保留合法位',
      custom.body.data.staff.permissions.length === 1 &&
      custom.body.data.staff.permissions[0] === 'orders:read',
      custom.body.data.staff.permissions.join(','));

    /* ---------- 6. 护栏：对自己、对最后一个 owner ---------- */
    section('6 护栏');
    const selfDisable = await call('PATCH', '/api/v1/admin/staff/' + myId,
      { status: 'disabled' }, { Authorization: owner });
    chk('不能停用自己', selfDisable.status === 409,
      selfDisable.body.error && selfDisable.body.error.message);

    const selfDelete = await call('DELETE', '/api/v1/admin/staff/' + myId, undefined,
      { Authorization: owner });
    chk('不能删自己', selfDelete.status === 409,
      selfDelete.body.error && selfDelete.body.error.message);

    /* 这一步是整套用例里唯一「万一护栏失效就自毁」的：
       基线只有一个 owner，降级成功意味着当前令牌立刻失去 staff:write，
       后面所有写操作都会 403。所以它必须是护栏验证的最后一步，
       且一旦意外成功立刻复位数据、中止剩余用例。 */
    const selfDemote = await call('PATCH', '/api/v1/admin/staff/' + myId,
      { role: 'ops' }, { Authorization: owner });
    chk('不能把最后一个 owner 降级', selfDemote.status === 409,
      selfDemote.body.error && selfDemote.body.error.message);
    if (selfDemote.status !== 409) {
      await resetData();
      aborted = true;
      throw new Error('护栏失效：最后一个 owner 被降级了。数据已复位，剩余用例已跳过。');
    }

    /* ---------- 7. 有第二个 owner 之后，降级就该被允许 ---------- */
    section('7 第二个 owner 存在时的行为');
    const toOwner = await call('PATCH', '/api/v1/admin/staff/' + bId,
      { role: 'owner' }, { Authorization: owner });
    chk('ops 可以提成 owner', toOwner.status === 200, toOwner.status);
    /* 别写死权限位总数：加一个 posts:write 就红一次，而真正要守的是
       「提成 owner 后拿到的权限 == 系统里全部权限位」。
       总数从同一个接口的 allPermissions 取，加权限时这条断言自动跟上。 */
    const allPerms = (list.body.data.allPermissions || []).length;
    chk('提成 owner 后自动全权限',
      allPerms > 0 && toOwner.body.data.staff.permissions.length === allPerms,
      toOwner.body.data.staff.permissions.length + ' / ' + allPerms);

    const demoteOwner2 = await call('PATCH', '/api/v1/admin/staff/' + bId,
      { role: 'support' }, { Authorization: owner });
    chk('有两个 owner 时，降级其中一个被允许', demoteOwner2.status === 200,
      demoteOwner2.body.error && demoteOwner2.body.error.message);

    /* ---------- 8. 密码 ---------- */
    section('8 密码');
    const selfPw = await call('PATCH', '/api/v1/admin/staff/' + myId,
      { password: 'brand-new-pass' }, { Authorization: owner });
    chk('改自己密码未验旧密码被拒', selfPw.status === 403,
      selfPw.body.error && selfPw.body.error.message);

    const wrongPw = await call('PATCH', '/api/v1/admin/staff/' + myId,
      { password: 'brand-new-pass', currentPassword: 'wrong-one' }, { Authorization: owner });
    chk('旧密码错也拒', wrongPw.status === 403, wrongPw.status);

    const c = await call('POST', '/api/v1/admin/staff',
      { name: 'Temp C', email: TMP_C, role: 'support', password: 'temp-pass-c' },
      { Authorization: owner });
    chk('建第三个账号', c.status === 201, c.status);
    const cId = c.body.data.staff.id;

    const cLogin1 = await call('POST', '/api/v1/admin/login', { email: TMP_C, password: 'temp-pass-c' });
    chk('新账号登录成功', cLogin1.status === 200);

    const reset = await call('PATCH', '/api/v1/admin/staff/' + cId,
      { password: 'reset-by-owner' }, { Authorization: owner });
    chk('owner 重置他人密码不用旧密码', reset.status === 200, reset.status);

    const cStale = await call('GET', '/api/v1/admin/me', undefined,
      { Authorization: 'Bearer ' + (cLogin1.body.data.token || '') });
    chk('重置后旧会话立即失效（401）', cStale.status === 401, cStale.status);

    const cLogin2 = await call('POST', '/api/v1/admin/login', { email: TMP_C, password: 'reset-by-owner' });
    chk('新密码可登录', cLogin2.status === 200, cLogin2.status);

    const cOldPw = await call('POST', '/api/v1/admin/login', { email: TMP_C, password: 'temp-pass-c' });
    chk('旧密码已失效', cOldPw.status === 401, cOldPw.status);

    /* ---------- 9. 停用与删除 ---------- */
    section('9 停用与删除');
    const off = await call('PATCH', '/api/v1/admin/staff/' + cId,
      { status: 'disabled' }, { Authorization: owner });
    chk('停用 200', off.status === 200 && off.body.data.staff.status === 'disabled');

    const offLogin = await call('POST', '/api/v1/admin/login', { email: TMP_C, password: 'reset-by-owner' });
    chk('停用后不能登录', offLogin.status === 401, offLogin.status);

    const offTok = await call('GET', '/api/v1/admin/me', undefined,
      { Authorization: 'Bearer ' + (cLogin2.body.data.token || '') });
    chk('停用后旧令牌失效', offTok.status === 401, offTok.status);

    const del = await call('DELETE', '/api/v1/admin/staff/' + cId, undefined, { Authorization: owner });
    chk('删除 200', del.status === 200, del.status);
    const gone = await call('DELETE', '/api/v1/admin/staff/' + cId, undefined, { Authorization: owner });
    chk('再删一次 404', gone.status === 404, gone.status);

    const audit = await call('GET', '/api/v1/admin/audit-log', undefined, { Authorization: owner });
    const acts = (audit.body.data || []).map(x => x.action);
    chk('审计留痕 staff.create', acts.indexOf('staff.create') >= 0);
    chk('审计留痕 staff.update', acts.indexOf('staff.update') >= 0);
    chk('审计留痕 staff.delete', acts.indexOf('staff.delete') >= 0);
    chk('审计里不含明文密码', JSON.stringify(audit.body.data || []).indexOf('reset-by-owner') < 0);
  } catch (e) {
    if (!aborted) {
      fail++;
      failures.push('未捕获异常：' + e.message);
      console.log('  ❌ 未捕获异常 — ' + e.message);
    }
  } finally {
    /* ---------- 10. 收尾：复位 ---------- */
    section('10 收尾');
    const r1 = await resetData();
    chk('数据已复位（假账号与角色改动一并清除）', r1.status === 200, r1.status);
    const check = await call('POST', '/api/v1/admin/login', OWNER);
    if (check.status === 200) {
      const tok = 'Bearer ' + check.body.data.token;
      const now = await call('GET', '/api/v1/admin/staff', undefined, { Authorization: tok });
      const rows = now.body.data.staff || [];
      chk('收尾后无残留测试账号', rows.filter(s => /@example\.com$/.test(s.email)).length === 0);
      const owners = rows.filter(s => s.role === 'owner' && s.status === 'active');
      chk('owner 账号已恢复', owners.length === 1 && owners[0].email === OWNER.email,
        owners.map(o => o.email).join(','));
    } else {
      chk('收尾登录', false, check.status);
    }

    console.log('\n' + '─'.repeat(52));
    console.log('通过 ' + pass + ' / 失败 ' + fail);
    if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  · ' + f)); }
    process.exit(fail ? 1 : 0);
  }
})();
