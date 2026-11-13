/* ============================================================
   TIDEGLASS Web · API 客户端
   所有请求集中在这里：统一错误解析、令牌注入、401 自动清理。
   前端任何地方都不直接写 fetch。
   ============================================================ */
(function () {
  'use strict';

  var BASE = window.TG_API_BASE || '/api/v1';

  function token() {
    try {
      var a = JSON.parse(localStorage.getItem('tideglass_admin') || 'null');
      return a && a.token ? a.token : '';
    } catch (e) { return ''; }
  }

  function ApiError(status, code, message, details) {
    var e = new Error(message || 'Request failed');
    e.status = status;
    e.code = code;
    e.details = details || null;
    return e;
  }

  async function request(method, path, body, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (opts.auth) {
      var t = token();
      if (t) headers.Authorization = 'Bearer ' + t;
    }
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    var res;
    try {
      res = await fetch(BASE + path, {
        method: method,
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
    }

    var text = await res.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }

    if (!res.ok) {
      var err = (json && json.error) || {};
      if (res.status === 401 && opts.auth) {
        /* 令牌失效：清掉本地会话，并留一句原因给登录页显示。
           早先这里是静默删除——用户点一个菜单就「退出登录」，没有任何解释，
           分不清是自己操作错了还是系统出问题。会话过期是正常事件，必须说清楚。 */
        localStorage.removeItem('tideglass_admin');
        try {
          sessionStorage.setItem('tideglass_admin_notice',
            err.message || 'Your session expired. Please sign in again.');
        } catch (e) { /* 隐私模式下 sessionStorage 可能不可写，忽略 */ }
      }
      throw ApiError(res.status, err.code || 'HTTP_' + res.status,
        err.message || 'Request failed (' + res.status + ')', err.details);
    }
    return json;
  }

  /* 取走「为什么被踢出来」的说明，取过即清，避免下次刷新还挂着 */
  function takeNotice() {
    try {
      var m = sessionStorage.getItem('tideglass_admin_notice');
      if (m) sessionStorage.removeItem('tideglass_admin_notice');
      return m || '';
    } catch (e) { return ''; }
  }

  window.API = {
    base: BASE,
    get: function (p, opts) { return request('GET', p, undefined, opts); },
    post: function (p, b, opts) { return request('POST', p, b, opts); },
    patch: function (p, b, opts) { return request('PATCH', p, b, opts); },
    del: function (p, opts) { return request('DELETE', p, undefined, opts); },
    token: token,
    takeNotice: takeNotice,
  };
})();
