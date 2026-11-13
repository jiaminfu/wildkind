const https = require('https');
const net = require('net');

function get(u, t = 15000) {
  return new Promise((r) => {
    const q = https.get(u, { timeout: t, headers: { accept: 'application/rdap+json' } }, (s) => {
      let b = '';
      s.on('data', (d) => (b += d));
      s.on('end', () => r({ status: s.statusCode, body: b }));
    });
    q.on('error', (e) => r({ status: 0, err: e.message }));
    q.on('timeout', () => { q.destroy(); r({ status: 0, err: 'timeout' }); });
  });
}

function whois(server, dom) {
  return new Promise((r) => {
    let b = '';
    const s = net.createConnection(43, server);
    s.setTimeout(12000);
    s.on('data', (d) => (b += d));
    s.on('end', () => r(b));
    s.on('error', (e) => r('ERR ' + e.message));
    s.on('timeout', () => { s.destroy(); r('TIMEOUT'); });
    s.write(dom + '\r\n');
  });
}

const coms = [
  'naiadejewelry.com', 'getnaiade.com', 'naiadestudio.com',
  'tideglass.com', 'getselkie.com', 'selkiestudio.com',
  'sereia.com', 'marea.com', 'everwave.com', 'selkie.com', 'naiade.com',
];

(async () => {
  for (const d of coms) {
    let r;
    for (let i = 0; i < 3; i++) {
      r = await get('https://rdap.verisign.com/com/v1/domain/' + d);
      if (r.status) break;
      await new Promise((x) => setTimeout(x, 1000));
    }
    const st = r.status === 404 ? 'AVAILABLE' : r.status === 200 ? 'TAKEN' : 'ERR_' + r.status;
    let extra = '';
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      extra = j.events
        .filter((e) => ['registration', 'expiration'].includes(e.eventAction))
        .map((e) => e.eventAction + ':' + e.eventDate.slice(0, 10))
        .join(' ');
    }
    console.log('COM ', d, '->', st, extra);
    await new Promise((x) => setTimeout(x, 700));
  }

  for (const d of ['sereia.co', 'marea.co', 'tideglass.co', 'naiade.co', 'everwave.co', 'selkie.co']) {
    const w = await whois('whois.nic.co', d);
    const avail = /No Data Found|NOT FOUND|No match|not found|Domain not found/i.test(w);
    const st = avail ? 'AVAILABLE' : /Domain Name:/i.test(w) ? 'TAKEN' : 'UNKNOWN';
    let ex = '';
    const cr = (w.match(/Creation Date:\s*(\S+)/i) || [])[1];
    const rg = (w.match(/Registrar:\s*(.+)/i) || [])[1];
    if (cr) ex = 'created:' + cr.slice(0, 10);
    if (rg) ex += ' ' + rg.trim().slice(0, 40);
    console.log('CO  ', d, '->', st, ex);
    await new Promise((x) => setTimeout(x, 700));
  }
})();
