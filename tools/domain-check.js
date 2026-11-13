// 品牌域名可用性核查 —— 走 IANA RDAP bootstrap，权威判定（不猜 DNS）
// 用法: node tools/domain-check.js
const https = require('https');
const fs = require('fs');

function get(url, timeout = 15000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout, headers: { 'accept': 'application/rdap+json, application/json' } }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', (e) => resolve({ status: 0, err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, err: 'timeout' }); });
  });
}

async function bootstrap() {
  const r = await get('https://data.iana.org/rdap/dns.json', 20000);
  if (r.status !== 200) throw new Error('bootstrap failed ' + r.status);
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
  return {
    created: (ev('registration') || {}).eventDate || '',
    expires: (ev('expiration') || {}).eventDate || '',
    registrar: name || '',
    status: (j.status || []).join(','),
  };
}

// 每个候选要查的域名组合
const CANDS = [
  { name: 'SEREIA', domains: ['sereia.com', 'sereia.co', 'sereia.shop', 'sereiajewelry.com', 'wearsereia.com', 'sereia.store'] },
  { name: 'MAREA', domains: ['marea.com', 'marea.co', 'marea.shop', 'mareajewelry.com', 'wearmarea.com', 'marea.store'] },
  { name: 'TIDEGLASS', domains: ['tideglass.com', 'tideglass.co', 'tideglass.shop', 'tideglassjewelry.com', 'tideglass.store'] },
  { name: 'NAIADE', domains: ['naiade.com', 'naiade.co', 'naiade.shop', 'naidejewelry.com', 'naiade.store'] },
  { name: 'EVERWAVE', domains: ['everwave.com', 'everwave.co', 'everwave.shop', 'everwavejewelry.com', 'everwave.store'] },
  { name: 'SELKIE', domains: ['selkie.com', 'selkie.co', 'selkie.shop', 'selkiejewelry.com', 'wearselkie.com', 'selkie.store'] },
];

(async () => {
  const map = await bootstrap();
  const out = [];
  for (const c of CANDS) {
    for (const d of c.domains) {
      const tld = d.split('.').pop();
      const base = map[tld];
      if (!base) { out.push({ cand: c.name, domain: d, state: 'NO_RDAP', note: '无 RDAP 服务，需人工查' }); continue; }
      const r = await get(base + 'domain/' + d);
      let state, note = '';
      if (r.status === 404) { state = 'AVAILABLE'; }
      else if (r.status === 200) {
        const info = parseReg(r.body);
        if (info) {
          state = 'TAKEN';
          note = [info.created && '注册于 ' + info.created.slice(0, 10), info.expires && '到期 ' + info.expires.slice(0, 10), info.registrar].filter(Boolean).join(' | ');
        } else { state = 'TAKEN'; }
      } else if (r.status === 429) { state = 'RATE_LIMIT'; }
      else { state = 'ERR_' + r.status; note = r.err || ''; }
      out.push({ cand: c.name, domain: d, state, note });
      process.stdout.write(c.name + ' ' + d + ' -> ' + state + ' ' + note + '\n');
    }
  }
  fs.writeFileSync(__dirname + '/domain-result.json', JSON.stringify(out, null, 2));
  console.log('\n写入 tools/domain-result.json');
})();
