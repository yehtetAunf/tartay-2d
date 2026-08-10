const ROUNDS=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
const PRE_SPIN_STEP_MS=10000;
const PRE_SPIN_CHANGE_ANIMATION_MS=580;

const roundsEl=document.getElementById("rounds");
const twoDEl=document.getElementById("twoD");
const updatedEl=document.getElementById("updatedText");
const onlineEl=document.querySelector(".online");
const preSpinLabel=document.getElementById("preSpinLabel");
const preSpinNumber=document.getElementById("preSpinNumber");

let loading=false;
let timer=null;
let serverBase=Date.now();
let perfBase=performance.now();
let holdActive=false;
let spinTimer=null;
let spinning=false;
let lastSpinResult="";

function estimatedServerNow(){return serverBase+(performance.now()-perfBase)}

function fmtUpdated(ms){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Yangon",day:"numeric",month:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return `${holdActive?"✓ ":""}Updated ${g("day")}/${g("month")}/${g("year")}, ${g("hour")}:${g("minute")}:${g("second")} ${(g("dayPeriod")||"").toUpperCase()}`;
}

function updateClock(){if(updatedEl)updatedEl.textContent=fmtUpdated(estimatedServerNow())}
function startClock(ms){
  serverBase=Number(ms)||Date.now();
  perfBase=performance.now();
  updateClock();
  if(!window.__clock)window.__clock=setInterval(updateClock,1000);
}

function setOnline(ok){
  if(!onlineEl)return;
  onlineEl.textContent=ok?"● LIVE":"● OFFLINE";
  onlineEl.style.opacity=ok?"1":".65";
}


let activeSpinTimer=null;
let activeRoundKey=null;

function randomSet(){
  const whole=Math.floor(1000+Math.random()*13900);
  const dec=Math.floor(Math.random()*100);
  return `${whole}.${String(dec).padStart(2,"0")}`;
}
function randomValue(){
  const whole=Math.floor(10000+Math.random()*890000);
  const dec=Math.floor(Math.random()*100);
  return `${whole}.${String(dec).padStart(2,"0")}`;
}
function stopActiveRowSpin(){
  if(activeSpinTimer){clearInterval(activeSpinTimer);activeSpinTimer=null}
  activeRoundKey=null;
}
function startActiveRowSpin(roundTime){
  if(!roundTime){stopActiveRowSpin();return}
  if(activeRoundKey===roundTime && activeSpinTimer)return;
  stopActiveRowSpin();
  activeRoundKey=roundTime;

  const tick=()=>{
    const row=roundsEl.querySelector(`[data-round="${roundTime}"]`);
    if(!row || row.classList.contains("released"))return;
    const s=row.querySelector(".set");
    const v=row.querySelector(".value");
    if(s)s.textContent=randomSet();
    if(v)v.textContent=randomValue();
    // IMPORTANT: row 2D must stay "--" until official result is released.
    const r=row.querySelector(".result");
    if(r)r.textContent="--";
  };
  tick();
  activeSpinTimer=setInterval(tick,700);
}

function getNextRound(results){
  const released=new Set(results.map(x=>x.round_time));
  return ROUNDS.find(t=>!released.has(t))||null;
}

function renderRows(results){
  const map=new Map(results.map(x=>[x.round_time,x]));
  const nextRound=getNextRound(results);

  roundsEl.innerHTML=ROUNDS.map(t=>{
    const x=map.get(t);
    const active=!x && t===nextRound;
    return `<div class="round-row ${x?'released':''} ${active?'active-spin':''}" data-round="${t}">
      <span class="time">${t}</span>
      <span class="set">${x?.set_value||'--'}</span>
      <span class="value">${x?.value_value||'--'}</span>
      <span class="result">${x?.result_2d||'--'}</span>
    </div>`;
  }).join("");

  if(nextRound)startActiveRowSpin(nextRound);
  else stopActiveRowSpin();
}

function renderState(data){
  const results=Array.isArray(data.results)?data.results:[];
  renderRows(results);
  const latest=results.length?results[results.length-1]:null;

  /*
    Big 2D:
    - official latest result is shown when server preSpin is inactive
    - while server preSpin is active, use its changing frame
    Existing server timing remains authoritative.
  */
  if(data.preSpin?.active){
    preSpinLabel.hidden=true;
    twoDEl.textContent=String(data.preSpin.frame ?? "--").padStart(2,"0");
    twoDEl.classList.add("spin");
  }else{
    preSpinLabel.hidden=true;
    twoDEl.textContent=latest?.result_2d||"--";
    twoDEl.classList.remove("spin");
  }

  startClock(data.serverNow);
  setOnline(true);
}

async function load(){
  if(loading)return;
  loading=true;
  try{
    const r=await fetch(`/api/state?t=${Date.now()}`,{cache:"no-store"});
    const d=await r.json();
    if(!r.ok||!d.success)throw new Error(d.error||`HTTP ${r.status}`);
    renderState(d);
  }catch(e){console.error(e);setOnline(false)}finally{loading=false}
}

function start(){
  load();
  timer=setInterval(()=>{if(document.visibilityState==="visible")load()},2000);
}

window.addEventListener("online",load);
window.addEventListener("offline",()=>setOnline(false));
window.addEventListener("focus",load);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")load()});
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
start();
