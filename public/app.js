const ROUNDS=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
const PRE_SPIN_STEP_MS=10000;
const PRE_SPIN_CHANGE_ANIMATION_MS=580;

const roundsEl=document.getElementById("rounds");
const twoDEl=document.getElementById("twoD");
const updatedEl=document.getElementById("updatedText");
const onlineEl=document.querySelector(".online");
const preSpinLabel=document.getElementById("preSpinLabel");
const preSpinNumber=document.getElementById("preSpinNumber");
const heroSetEl=document.getElementById("heroSet");
const heroValueEl=document.getElementById("heroValue");
const mondayNotice=document.getElementById("mondayNotice");

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
  return `${holdActive?"✅ ":""}Updated ${g("day")}/${g("month")}/${g("year")}, ${g("hour")}:${g("minute")}:${g("second")} ${(g("dayPeriod")||"").toUpperCase()}`;
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
let marketBase=null;
let marketJumpTimer=null;
let marketJumpIndex=0;
let marketBlinkTimer=null;

const MARKET_JUMP_MS=10000;
const BLINK_INTERVAL_MS=3500;

function getNextRound(results){
  const released=new Set(results.map(x=>x.round_time));
  return ROUNDS.find(t=>!released.has(t))||null;
}

function format2(n){
  return Number(n).toFixed(2);
}

/*
  The API remains the baseline.
  To make SET / VALUE visibly "jump" like the reference video,
  the screen derives a small moving display value from the latest
  API baseline every 5 seconds.
*/
function makeJumpMarket(base,index){
  if(!base?.ok)return {ok:false,set:"--",value:"--"};

  const baseSet=Number(base.set);
  const baseValue=Number(base.value);
  if(!Number.isFinite(baseSet)||!Number.isFinite(baseValue)){
    return {ok:false,set:"--",value:"--"};
  }

  // SET is the volume-side feed: larger visible movement.
  const setSteps=[0,-297.98,-275.79,126.24,-143.67,218.31,-84.52,341.16];
  const setValue=Math.max(0,baseSet+setSteps[index%setSteps.length]);

  // VALUE is the price-side feed: small cent-level movement.
  const valueSteps=[0,.03,.06,.02,.08,.05,.11,.07];
  const valueValue=baseValue+valueSteps[index%valueSteps.length];

  return {
    ok:true,
    set:format2(setValue),
    value:format2(valueValue)
  };
}

function calculate2DFromSetValue(setValue,valueValue){
  const setText=String(setValue??"").trim();
  const valueText=String(valueValue??"").trim();

  const setDigits=setText.replace(/\D/g,"");
  if(!setDigits)return null;
  const setDigit=setDigits.slice(-1);

  const valueInteger=valueText.split(".")[0].replace(/\D/g,"");
  if(!valueInteger)return null;
  const valueDigit=valueInteger.slice(-1);

  return `${setDigit}${valueDigit}`;
}

function paintActiveMarket(){
  // Never let the live market repaint the hero while an Admin result is in its 2-minute hold.
  if(holdActive)return;
  if(!activeRoundKey||!marketBase?.ok)return;

  const market=makeJumpMarket(marketBase,marketJumpIndex);
  const row=roundsEl.querySelector(`[data-round="${activeRoundKey}"]`);
  if(!row||row.classList.contains("released"))return;

  const s=row.querySelector(".set");
  const v=row.querySelector(".value");
  const r=row.querySelector(".result");

  if(s)s.textContent=market.set;
  if(v)v.textContent=market.value;
  if(r)r.textContent="--";
  if(heroSetEl)heroSetEl.textContent=market.set;
  if(heroValueEl)heroValueEl.textContent=market.value;

  const big2D=calculate2DFromSetValue(market.set,market.value);
  if(big2D)twoDEl.textContent=big2D;
}

function blinkActiveNumbers(){
  if(!activeRoundKey)return;
  const row=roundsEl.querySelector(`[data-round="${activeRoundKey}"]`);
  if(!row||row.classList.contains("released"))return;
  const nodes=[twoDEl,row.querySelector(".set"),row.querySelector(".value")];
  if(nodes.some(node=>!node||node.textContent.trim()==="--"))return;
  nodes.forEach(node=>node.classList.remove("blink-change"));
  void nodes[0].offsetWidth;
  nodes.forEach(node=>node.classList.add("blink-change"));
}

function startMarketBlink(){
  if(marketBlinkTimer)return;
  blinkActiveNumbers();
  marketBlinkTimer=setInterval(blinkActiveNumbers,BLINK_INTERVAL_MS);
}

function startMarketJump(){
  if(marketJumpTimer)return;
  marketJumpTimer=setInterval(()=>{
    marketJumpIndex=(marketJumpIndex+1)%100000;
    paintActiveMarket();
  },MARKET_JUMP_MS);
}

function renderRows(results,market){
  const map=new Map(results.map(x=>[x.round_time,x]));
  const nextRound=getNextRound(results);
  activeRoundKey=nextRound;
  marketBase=market?.ok?market:null;

  const live=makeJumpMarket(marketBase,marketJumpIndex);

  roundsEl.innerHTML=ROUNDS.map(t=>{
    const x=map.get(t);
    const active=!x&&t===nextRound;
    return `<div class="round-row ${x?'released':''} ${active?'active-spin':''}" data-round="${t}" data-index="${ROUNDS.indexOf(t)+1}">
      <span class="time">${t}</span>
      <span class="set">${x?.set_value||(active?live.set:'--')}</span>
      <span class="value">${x?.value_value||(active?live.value:'--')}</span>
      ${x ? `<span class="result">${x.result_2d||'--'}</span>` : `<span class="round-cover" aria-label="Result pending"></span>`}
    </div>`;
  }).join("");

  if(nextRound&&marketBase?.ok){
    paintActiveMarket();
    startMarketJump();
    startMarketBlink();
  }
}

function stopLiveMotion(){
  if(marketJumpTimer){clearInterval(marketJumpTimer);marketJumpTimer=null;}
  if(marketBlinkTimer){clearInterval(marketBlinkTimer);marketBlinkTimer=null;}
  twoDEl.classList.remove("blink-change","spin");
}


function isYangonMonday(ms){
  const now=new Date(Number(ms)||Date.now());
  const weekday=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Yangon",weekday:"short"}).format(now);
  if(weekday!=="Mon")return false;

  // Midnight belongs to the previous result day until 12:30 AM.
  // This keeps the 12:00 AM result visible before Monday CLOSED begins.
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Yangon",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const get=t=>Number(parts.find(x=>x.type===t)?.value||0);
  return get("hour")>0 || (get("hour")===0 && get("minute")>=30);
}

function renderMondayClosed(ms){
  stopLiveMotion();
  holdActive=false;
  activeRoundKey=null; marketBase=null;
  twoDEl.textContent="CLOSED";
  twoDEl.classList.add("closed-result");
  if(heroSetEl)heroSetEl.textContent="--";
  if(heroValueEl)heroValueEl.textContent="--";
  if(preSpinLabel)preSpinLabel.hidden=true;
  if(mondayNotice)mondayNotice.hidden=false;
  roundsEl.innerHTML=ROUNDS.map(t=>`<div class="round-row monday-closed" data-round="${t}"><span class="time">${t}</span><span class="set">--</span><span class="value">--</span><span class="closed-mark">▣</span><span class="closed-text">CLOSED</span></div>`).join("");
  startClock(ms);
  setOnline(true);
}

function renderState(data){
  if(isYangonMonday(data.serverNow)){renderMondayClosed(data.serverNow);return;}
  twoDEl.classList.remove("closed-result");
  if(mondayNotice)mondayNotice.hidden=true;
  const results=Array.isArray(data.results)?data.results:[];
  const latest=results.length?results[results.length-1]:null;
  // Set hold state BEFORE painting the hero values. During the 2-minute
  // published-result hold, SET / VALUE / 2D must all come from the exact
  // Admin-saved round, not from the live market feed.
  holdActive=Boolean(data.resultHold?.active);
  const heldRound=holdActive
    ? results.find(x=>x.round_time===data.resultHold?.round_time)
    : null;

  if(heroSetEl)heroSetEl.textContent=holdActive
    ? (heldRound?.set_value||"--")
    : (data.market?.ok?data.market.set:(latest?.set_value||"--"));
  if(heroValueEl)heroValueEl.textContent=holdActive
    ? (heldRound?.value_value||"--")
    : (data.market?.ok?data.market.value:(latest?.value_value||"--"));

  renderRows(results,data.market);

  if(holdActive){
    // Freeze the complete Admin-published result for the exact 2-minute window.
    stopLiveMotion();
    preSpinLabel.hidden=true;
    twoDEl.textContent=data.resultHold?.result_2d||heldRound?.result_2d||latest?.result_2d||"--";
  }else if(activeRoundKey&&marketBase?.ok){
    // After the 2-minute hold, resume live SET/VALUE + large 2D movement.
    paintActiveMarket();
    startMarketJump();
    startMarketBlink();
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
