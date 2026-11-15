// 品牌域名可用性核查 —— 走 IANA RDAP bootstrap，权威判定（不猜 DNS）
//
// 用法:
//   node tools/domain-check.js loom loomly weft            # 默认查 .com
//   node tools/domain-check.js --tld=com,co,shop pluma     # 多后缀
//   node tools/domain-check.js --json --quiet a b c        # 机器可读
//
// 判读:
//   404 → 注册局无记录 = 可注册（唯一可作为结论的信号）
//   200 → 已注册，附带注册年份/到期/注册商
//   其它 → 查询异常，不能当作可用
//
// 为什么不看 DNS: 没解析 ≠ 没注册。大量域名挂着待售、停放页或闲置，照样在别人名下。
const https = require('https');
const fs = require('fs');
const path = require('path');

const UA = 'brand-domain-check/1.1';

function get(url, timeout = 15000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout, headers: { accept: 'application/rdap+json, application/json', 'user-agent': UA } }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, err: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'timeout' }); });
  });
}

async function bootstrap() {
  const r = await get('https://data.iana.org/rdap/dns.json', 20000);
  if (r.status !== 200) throw new Error('RDAP bootstrap 失败 ' + r.status);
  const j = JSON.parse(r.body);
  const map = {};
  for (const [tlds, urls] of j.services) {
    const base = urls.find((u) => u.startsWith('https')) || urls[0];
    for (const t of tlds) map[t.toLowerCase()] = base.endsWith('/') ? base : base + '/';
  }
  return map;
}

function parseReg(body) {
  let j;
  try { j = JSON.parse(body); } catch (e) { return null; }
  const ev = (t) => (j.events || []).find((e) => e.eventAction === t);
  const reg = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const vcard = reg && reg.vcardArray && reg.vcardArray[1];
  const name = vcard && (vcard.find((x) => x[0] === 'fn') || [])[3];
  const created = (ev('registration') || {}).eventDate || '';
  return {
    created: created ? created.slice(0, 10) : '',
    createdYear: created ? created.slice(0, 4) : '',
    expires: ((ev('expiration') || {}).eventDate || '').slice(0, 10),
    registrar: name || '',
    status: (j.status || []).join(','),
  };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
      await new Promise((r) => setTimeout(r, 150)); // 轻间隔，避免被注册局判成扫描
    }
  }));
  return out;
}

(async () => {
  let args = process.argv.slice(2);
  const opt = { tlds: ['com'], json: false, quiet: false };
  args = args.filter((a) => {
    if (a.startsWith('--tld=')) { opt.tlds = a.slice(6).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); return false; }
    if (a === '--json') { opt.json = true; return false; }
    if (a === '--quiet') { opt.quiet = true; return false; }
    return true;
  });

  const names = [...new Set(args.map((s) => s.toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9-]/g, '').trim()).filter(Boolean))];
  if (!names.length) {
    console.error('用法: node tools/domain-check.js [--tld=com,co] [--json] [--quiet] name1 name2 ...');
    process.exit(1);
  }

  const map = await bootstrap();
  const tasks = [];
  for (const n of names) for (const t of opt.tlds) tasks.push({ name: n, tld: t, domain: n + '.' + t });

  const results = await pool(tasks, 6, async (it) => {
    const base = map[it.tld];
    if (!base) return Object.assign({}, it, { state: 'NO_RDAP', note: '该后缀无公共 RDAP，需人工查' });
    const r = await get(base + 'domain/' + it.domain);
    if (r.status === 404) return Object.assign({}, it, { state: 'AVAILABLE' });
    if (r.status === 200) {
      const info = parseReg(r.body) || {};
      const note = [info.createdYear && '注册于 ' + info.createdYear, info.expires && '到期 ' + info.expires, info.registrar]
        .filter(Boolean).join(' | ');
      return Object.assign({}, it, { state: 'TAKEN' }, info, { note });
    }
    if (r.status === 429) return Object.assign({}, it, { state: 'RATE_LIMIT', note: '被限流，需重查' });
    return Object.assign({}, it, { state: 'ERR', note: (r.err || 'HTTP ' + r.status) });
  });

  const by = (s) => results.filter((r) => r.state === s);
  const avail = by('AVAILABLE'), taken = by('TAKEN');
  const other = results.filter((r) => !['AVAILABLE', 'TAKEN'].includes(r.state));

  if (opt.json) {
    const out = path.join(__dirname, 'domain-result.json');
    fs.writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
    console.log(out);
    return;
  }

  if (!opt.quiet) {
    console.log('查询 ' + results.length + ' 个 —— 可注册 ' + avail.length + ' / 已注册 ' + taken.length + ' / 异常 ' + other.length + '\n');
    if (avail.length) {
      console.log('✓ 可注册');
      avail.forEach((r) => console.log('   ' + r.domain));
      console.log('');
    }
    if (taken.length) {
      console.log('✗ 已注册');
      taken.forEach((r) => console.log('   ' + r.domain.padEnd(26) + (r.note || '')));
      console.log('');
    }
    if (other.length) {
      console.log('? 查询异常（不可当作可用）');
      other.forEach((r) => console.log('   ' + r.domain.padEnd(26) + r.state + ' ' + (r.note || '')));
      console.log('');
    }
  }
  // 无论安静与否都写盘，方便脚本串联
  const out = path.join(__dirname, 'domain-result.json');
  fs.writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  if (!opt.quiet) console.log('完整结果 → tools/domain-result.json');
})();
