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

function renderRows(results){
  const map=new Map(results.map(x=>[x.round_time,x]));
  const latest=results.length?results[results.length-1]:null;
  roundsEl.innerHTML=ROUNDS.map(t=>{
    const x=map.get(t),current=latest&&latest.round_time===t;
    return `<div class="round-row ${x?'released':''} ${current?'current':''}" data-round="${t}"><span class="time">${t}</span><span class="set">${x?.set_value||'--'}</span><span class="value">${x?.value_value||'--'}</span><span class="result">${x?.result_2d||'--'}</span></div>`;
  }).join("");
}

function random2D(){
  let next="";
  do{next=String(Math.floor(Math.random()*100)).padStart(2,"0")}while(next===lastSpinResult);
  lastSpinResult=next;
  return next;
}

function animateSpinChange(value){
  if(!twoDEl)return;
  twoDEl.textContent=String(value??"--").padStart(2,"0");
  twoDEl.classList.remove("pre-spin-change");
  void twoDEl.offsetWidth;
  twoDEl.classList.add("pre-spin-change");
  window.setTimeout(()=>twoDEl.classList.remove("pre-spin-change"),PRE_SPIN_CHANGE_ANIMATION_MS+40);
}

function showNextSpinFrame(){
  if(!spinning||holdActive)return;
  animateSpinChange(random2D());
}

function startBigSpin(initialFrame){
  if(initialFrame!=null&&/^\d{1,2}$/.test(String(initialFrame))){
    const initial=String(initialFrame).padStart(2,"0");
    lastSpinResult=initial;
    animateSpinChange(initial);
  }
  if(spinning)return;
  spinning=true;
  twoDEl.classList.add("spin");
  if(spinTimer){clearInterval(spinTimer)}
  spinTimer=setInterval(showNextSpinFrame,PRE_SPIN_STEP_MS);
}

function stopBigSpin(result){
  spinning=false;
  if(spinTimer){clearInterval(spinTimer);spinTimer=null}
  twoDEl.classList.remove("spin","pre-spin-change");
  twoDEl.textContent=result||"--";
  lastSpinResult=String(result||"");
}

function renderState(data){
  const results=Array.isArray(data.results)?data.results:[];
  renderRows(results);
  const latest=results.length?results[results.length-1]:null;
  holdActive=Boolean(data.resultHold?.active);

  if(holdActive){
    stopBigSpin(data.resultHold.result_2d||latest?.result_2d||"--");
  }else if(data.preSpin?.active){
    startBigSpin(data.preSpin.frame);
  }else{
    stopBigSpin(latest?.result_2d||"--");
  }

  if(preSpinLabel)preSpinLabel.hidden=true;
  if(preSpinNumber)preSpinNumber.textContent=data.preSpin?.frame||"--";

  startClock(data.serverNow);
  updateClock();
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
