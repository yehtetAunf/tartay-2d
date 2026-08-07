const $=id=>document.getElementById(id);
const TIMES=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
const esc=v=>String(v??'--').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
function setStatus(code,text){$('statusBadge').className='status '+code;$('statusText').textContent=text}
function fmt(v){if(!v)return'Waiting for result';try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yangon',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date(v))}catch{return'Waiting for result'}}
function renderRounds(rows=[]){const map=new Map(rows.map(r=>[String(r.time||r.result_time||'').replace(/^5:/,'05:').replace(/^6:/,'06:').replace(/^7:/,'07:').replace(/^8:/,'08:').replace(/^9:/,'09:'),r]));$('roundGrid').innerHTML=TIMES.map(t=>{const r=map.get(t)||{};const result=/^\d{2}$/.test(String(r.result||r.result_number||''))?String(r.result||r.result_number):'--';const pub=result!=='--';return `<article class="round-card ${pub?'published':''}">${pub?'<span class="check">✓</span>':''}<div class="round-time">◷ ${t}</div><div class="round-number ${pub?'':'waiting'}">${esc(result)}</div></article>`}).join('')}
async function loadResults(){try{const r=await fetch('/api/state?t='+Date.now(),{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error();const rows=Array.isArray(d.rounds)?d.rounds:[];renderRounds(rows);const latest=d.latest||rows.filter(x=>x.publishedAt&&/^\d{2}$/.test(String(x.result||''))).at(-1)||null;$('bigResult').textContent=latest?.result||'--';$('liveSet').textContent=latest?.set||'--';$('liveValue').textContent=latest?.value||'--';$('updatedText').textContent=latest?fmt(latest.publishedAt||d.updatedAt):'Waiting for result';setStatus(d.live===false?'waiting':'live',d.live===false?'WAIT':'LIVE')}catch(e){renderRounds([]);setStatus('offline','OFFLINE')}}
$('refreshBtn').onclick=loadResults;
setInterval(loadResults,10000);
renderRounds([]);loadResults();

const overlay=$('betOverlay'),sheet=$('betSheet');
function openSheet(){sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');overlay.classList.remove('hidden')}
function closeSheet(){sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true');overlay.classList.add('hidden')}
$('openBet').onclick=openSheet;$('closeSheet').onclick=closeSheet;overlay.onclick=closeSheet;
$('loginBtn').onclick=()=>{$('loginMessage').textContent='Account system is not connected yet.';$('loginMessage').className='message err'};
