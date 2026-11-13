const https=require('https');
function get(u,t=15000){return new Promise(r=>{const q=https.get(u,{timeout:t,headers:{accept:'application/rdap+json'}},s=>{let b='';s.on('data',d=>b+=d);s.on('end',()=>r({status:s.statusCode,body:b}))});q.on('error',e=>r({status:0,err:e.message}));q.on('timeout',()=>{q.destroy();r({status:0,err:'timeout'})})})}
const list=[['sereia.co','https://rdap.nic.co/domain/'],['marea.co','https://rdap.nic.co/domain/'],['naiade.co','https://rdap.nic.co/domain/'],['everwave.co','https://rdap.nic.co/domain/'],['tideglass.co','https://rdap.nic.co/domain/'],['selkie.co','https://rdap.nic.co/domain/'],['wearmarea.com','https://rdap.verisign.com/com/v1/domain/'],['wearselkie.com','https://rdap.verisign.com/com/v1/domain/']];
(async()=>{for(const [d,b] of list){let r;for(let i=0;i<3;i++){r=await get(b+d);if(r.status)break;await new Promise(x=>setTimeout(x,1200))}
let st=r.status===404?'AVAILABLE':r.status===200?'TAKEN':'ERR_'+r.status;
console.log(d,'->',st, r.status===200?JSON.parse(r.body).events.map(e=>e.eventAction+':'+e.eventDate.slice(0,10)).join(' '):'');
await new Promise(x=>setTimeout(x,600))}})();
