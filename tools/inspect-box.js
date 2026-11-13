/* 一次性排查工具：打印指定页面关键元素的实际布局盒 */
const { spawn } = require('child_process');
const http = require('http'), path = require('path'), os = require('os'), fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9336;
const wait = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

const URL = process.argv[2] || 'http://localhost:4500/#/checkout?demo=pay';
const SEL = process.argv[3] || '.co__steps';

(async () => {
  const PROF = path.join(os.tmpdir(), 'edge_insp2');
  try { fs.rmSync(PROF, { recursive: true, force: true }); } catch (e) { }
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROF, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) {
    try { const v = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); if (v && v.length) { t = v; break; } } catch (e) { }
    await wait(250);
  }
  const page = t.filter(x => x.type === 'page')[0];
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    sock.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
  sock.addEventListener('message', ev => {
    const o = JSON.parse(ev.data);
    if (o.id && pend.has(o.id)) { const p = pend.get(o.id); pend.delete(o.id); o.error ? p.rej(new Error(o.error.message)) : p.res(o.result); }
  });
  await new Promise(r => sock.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? ('ERR ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)) : r.result.value;
  };

  await send('Page.navigate', { url: URL });
  await wait(3200);
  console.log('hash=' + await ev('location.hash') + ' appLen=' + await ev('(document.getElementById("app")||{innerHTML:{length:0}}).innerHTML.length'));

  if (SEL.indexOf('js:') === 0) {
    console.log(await ev(SEL.slice(3)));
    sock.close(); proc.kill(); process.exit(0);
  }
  const out = await ev(`(function(){
    var out=[];
    var box=document.querySelector(${JSON.stringify(SEL)});
    if(!box) return 'NOT FOUND: ' + ${JSON.stringify(SEL)};
    function box2(el,tag){
      var r=el.getBoundingClientRect(), c=getComputedStyle(el);
      out.push(tag+' <'+el.tagName.toLowerCase()+' class="'+el.className+'"> x='+Math.round(r.x)+' y='+Math.round(r.y)+
        ' w='+Math.round(r.width)+' h='+Math.round(r.height)+
        ' | display='+c.display+' flex='+c.flexDirection+'-'+c.flexWrap+' justify='+c.justifyContent+
        ' align='+c.alignItems+' grid='+c.gridTemplateColumns+' textAlign='+c.textAlign);
    }
    box2(box,'TARGET');
    [].forEach.call(box.children,function(c,i){
      box2(c,'  child'+i);
      var t=c.innerText.replace(/\\s+/g,' ').slice(0,40);
      out.push('       text="'+t+'"');
    });
    box2(box.parentElement,'PARENT');
    return out.join('\\n');
  })()`);
  console.log(out);

  sock.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
