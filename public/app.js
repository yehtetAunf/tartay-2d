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



let activeRoundKey=null;

function getNextRound(results){
  const released=new Set(results.map(x=>x.round_time));
  return ROUNDS.find(t=>!released.has(t))||null;
}

function renderRows(results, market){
  const map=new Map(results.map(x=>[x.round_time,x]));
  const nextRound=getNextRound(results);
  activeRoundKey=nextRound;

  const liveSet=market?.ok ? market.set : "--";
  const liveValue=market?.ok ? market.value : "--";

  roundsEl.innerHTML=ROUNDS.map(t=>{
    const x=map.get(t);
    const active=!x && t===nextRound;
    return `<div class="round-row ${x?'released':''} ${active?'active-spin':''}" data-round="${t}">
      <span class="time">${t}</span>
      <span class="set">${x?.set_value || (active?liveSet:'--')}</span>
      <span class="value">${x?.value_value || (active?liveValue:'--')}</span>
      <span class="result">${x?.result_2d||'--'}</span>
    </div>`;
  }).join("");
}


function calculate2DFromSetValue(setValue, valueValue){
  const setText=String(setValue ?? "").trim();
  const valueText=String(valueValue ?? "").trim();

  const setDigits=setText.replace(/\D/g,"");
  if(!setDigits)return null;
  const setDigit=setDigits.slice(-1);

  const valueInteger=valueText.split(".")[0].replace(/\D/g,"");
  if(!valueInteger)return null;
  const valueDigit=valueInteger.slice(-1);

  return `${setDigit}${valueDigit}`;
}

function renderState(data){
  const results=Array.isArray(data.results)?data.results:[];
  renderRows(results, data.market);
  const latest=results.length?results[results.length-1]:null;

  // Big 2D follows the requested SET/VALUE rule while the active round is live:
  // SET last digit + VALUE last digit before decimal.
  // Example: SET 1367.42, VALUE 56789.81 => 29.
  // Row-level 2D still remains "--" until the official round result is released.
  const market2D=data.market?.ok
    ? calculate2DFromSetValue(data.market.set,data.market.value)
    : null;

  if(activeRoundKey && market2D){
    preSpinLabel.hidden=true;
    twoDEl.textContent=market2D;
    twoDEl.classList.add("spin");
  }else{
    preSpinLabel.hidden=true;
    twoDEl.textContent=latest?.result_2d||"--";
    twoDEl.classList.remove("spin");
  }

  holdActive=Boolean(data.resultHold?.active);
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
