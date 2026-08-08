const $ = (id) => document.getElementById(id);
const TIMES = ["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
const big = $("bigResult"), liveSet = $("liveSet"), liveValue = $("liveValue"), updated = $("updatedText"), grid = $("roundGrid"), statusBadge = $("statusBadge"), statusText = $("statusText");
let serverBase = Date.now(), perfBase = performance.now(), preSpinFrames = [], preSpinTarget = 0, preSpinTimer = null, preSpinInterval = null, boundaryTimer = null, lastPublishedStamp = "";
const esc = (v) => String(v ?? "--").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
function serverNow(){return serverBase + (performance.now()-perfBase)}
function setStatus(code,text){statusBadge.className="status "+code;statusText.textContent=text}
function animate(nodes,cls="number-blink"){nodes.filter(Boolean).forEach(n=>{n.classList.remove(cls);void n.offsetWidth;n.classList.add(cls)})}
function stopPreSpin(){if(preSpinTimer)clearTimeout(preSpinTimer);if(preSpinInterval)clearInterval(preSpinInterval);preSpinTimer=preSpinInterval=null}
function showSpinFrame(){if(!preSpinFrames.length)return;const f=preSpinFrames[Math.floor(Math.random()*preSpinFrames.length)];big.textContent=f.result||"--";liveSet.textContent=f.set||"--";liveValue.textContent=f.value||"--"}
function schedulePreSpin(target){stopPreSpin();preSpinTarget=Number(target)||0;if(!preSpinTarget||!preSpinFrames.length)return;const lead=15000,delay=preSpinTarget-serverNow();if(delay<=0)return;const begin=()=>{showSpinFrame();preSpinInterval=setInterval(showSpinFrame,2500)};if(delay<=lead)begin();else preSpinTimer=setTimeout(begin,delay-lead)}
function scheduleBoundary(target){if(boundaryTimer)clearTimeout(boundaryTimer);const t=Number(target)||0;if(!t)return;const delay=t-serverNow();boundaryTimer=setTimeout(async()=>{for(let i=0;i<12;i++){await loadResults(true);if(Number(preSpinTarget)!==t)break;await new Promise(r=>setTimeout(r,450))}},Math.max(50,delay+40))}
function formatUpdated(v){if(!v)return "Waiting for result";const raw=String(v);const d=new Date(raw.includes("T")?raw:raw.replace(" ","T")+"Z");if(Number.isNaN(d.getTime()))return raw;return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).format(d)}
function normalizeTime(v){return String(v||"").trim().replace(/^0?(\d):/,m=>m.length===2?"0"+m:m).toUpperCase()}
function renderRounds(rows){
  const source=Array.isArray(rows)?rows:[];
  const byTime=new Map(source.map(r=>[normalizeTime(r.result_time),r]));
  grid.innerHTML=TIMES.map(time=>{
    const r=byTime.get(time)||{};
    const pub=r.status==="published" && /^\d{2}$/.test(String(r.result_number||""));
    const set=pub?(r.set??r.set_value??"--"):"--";
    const value=pub?(r.value??r.value_value??"--"):"--";
    const num=pub?r.result_number:"--";
    return `<article class="result-card ${pub?"published":"waiting"}"><div class="result-head"><div>Time</div><div>Set</div><div>Value</div><div>2D</div></div><div class="result-body"><div class="cell-time">${esc(time)}</div><div class="cell-set">${esc(set)}</div><div class="cell-value">${esc(value)}</div><div class="cell-2d">${esc(num)}</div></div></article>`;
  }).join("");
}
async function loadResults(boundary=false){
  try{
    const r=await fetch("/api/results?t="+Date.now(),{cache:"no-store"}),d=await r.json();
    if(!r.ok||!d.success)throw new Error("API");
    serverBase=Number(d.serverNow)||Date.now();perfBase=performance.now();preSpinFrames=Array.isArray(d.preSpinFrames)?d.preSpinFrames:[];
    const oldTarget=preSpinTarget;preSpinTarget=Number(d.nextAutoPublishAtMs)||0;
    renderRounds(d.results||[]);
    const live=d.live||{};
    if(!preSpinInterval){big.textContent=live.result||"--";liveSet.textContent=live.set||"--";liveValue.textContent=live.value||"--"}
    updated.textContent=formatUpdated(live.updated_at);
    const stamp=String(live.updated_at||"");if(stamp&&stamp!==lastPublishedStamp){lastPublishedStamp=stamp;animate([big,liveSet,liveValue],"number-pop")}
    setStatus(preSpinTarget?"live":"waiting",preSpinTarget?"LIVE":"WAIT");schedulePreSpin(preSpinTarget);scheduleBoundary(preSpinTarget);if(boundary&&oldTarget&&oldTarget!==preSpinTarget)stopPreSpin();
  }catch(e){setStatus("offline","OFFLINE");renderRounds([])}
}
renderRounds([]);
setInterval(()=>loadResults(),10000);
loadResults();
