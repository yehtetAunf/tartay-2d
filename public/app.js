const ROUNDS=[
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
  "08:00 PM",
  "09:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM"
];

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

function estimatedServerNow(){
  return serverBase+(performance.now()-perfBase);
}

function fmtUpdated(ms){

  const p=new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:"Asia/Yangon",
      day:"numeric",
      month:"numeric",
      year:"numeric",
      hour:"numeric",
      minute:"2-digit",
      second:"2-digit",
      hour12:true
    }
  ).formatToParts(new Date(ms));

  const g=t=>
    p.find(x=>x.type===t)?.value||"";

  return `Updated ${g("day")}/${g("month")}/${g("year")}, ${g("hour")}:${g("minute")}:${g("second")} ${(g("dayPeriod")||"").toUpperCase()}`;
}

function updateClock(){

  if(updatedEl){
    updatedEl.textContent=
      fmtUpdated(estimatedServerNow());
  }

}

function startClock(ms){

  serverBase=Number(ms)||Date.now();
  perfBase=performance.now();

  updateClock();

  if(!window.__clock){
    window.__clock=
      setInterval(updateClock,1000);
  }

}

function setOnline(ok){

  if(!onlineEl)return;

  onlineEl.textContent=
    ok?"● LIVE":"● OFFLINE";

  onlineEl.style.opacity=
    ok?"1":".65";
}

function renderRows(results){

  const map=
    new Map(
      results.map(
        x=>[x.round_time,x]
      )
    );

  const latest=
    results.length
      ?results[results.length-1]
      :null;

  roundsEl.innerHTML=
    ROUNDS.map(t=>{

      const x=map.get(t);

      const current=
        latest&&
        latest.round_time===t;

      return `
        <div
          class="round-row ${x?'released':''} ${current?'current':''}"
          data-round="${t}"
        >
          <span class="time">
            ${t}
          </span>

          <span class="set">
            ${x?.set_value||'--'}
          </span>

          <span class="value">
            ${x?.value_value||'--'}
          </span>

          <span class="result">
            ${x?.result_2d||'--'}
          </span>
        </div>
      `;

    }).join("");
}

function renderState(data){

  const results=
    Array.isArray(data.results)
      ?data.results
      :[];

  renderRows(results);

  const latest=
    results.length
      ?results[results.length-1]
      :null;


  /* ===============================
     BIG 2D RESULT
  =============================== */

  if(data.preSpin?.active){

    /*
      Round မထွက်ခင်
      server ကပို့လာတဲ့ frame ကို
      BIG 2D မှာ တိုက်ရိုက်ပြမယ်
    */

    const frame=
      String(
        data.preSpin.frame ?? "--"
      ).padStart(2,"0");

    twoDEl.textContent=frame;

    twoDEl.classList.add("spin");


    /*
      pre-spin စာကို မပြချင်ရင်
      hidden ထားမယ်
    */

    if(preSpinLabel){
      preSpinLabel.hidden=true;
    }

    if(preSpinNumber){
      preSpinNumber.textContent=frame;
    }

  }else{

    /*
      Round ထွက်ပြီးရင်
      အမှန် 2D Result မှာ ရပ်မယ်
    */

    twoDEl.textContent=
      latest?.result_2d||"--";

    twoDEl.classList.remove("spin");

    if(preSpinLabel){
      preSpinLabel.hidden=true;
    }

  }


  startClock(data.serverNow);

  setOnline(true);
}


/* ===============================
   LOAD STATE
=============================== */

async function load(){

  if(loading)return;

  loading=true;

  try{

    const r=
      await fetch(
        `/api/state?t=${Date.now()}`,
        {
          cache:"no-store"
        }
      );

    const d=
      await r.json();

    if(
      !r.ok||
      !d.success
    ){
      throw new Error(
        d.error||
        `HTTP ${r.status}`
      );
    }

    renderState(d);

  }catch(e){

    console.error(e);

    setOnline(false);

  }finally{

    loading=false;

  }

}


/* ===============================
   START
=============================== */

function start(){

  load();

  /*
    2 seconds တစ်ကြိမ်
    server state ပြန်ယူမယ်
  */

  timer=setInterval(()=>{

    if(
      document.visibilityState===
      "visible"
    ){
      load();
    }

  },2000);

}


window.addEventListener(
  "online",
  load
);

window.addEventListener(
  "offline",
  ()=>setOnline(false)
);

window.addEventListener(
  "focus",
  load
);

document.addEventListener(
  "visibilitychange",
  ()=>{

    if(
      document.visibilityState===
      "visible"
    ){
      load();
    }

  }
);


if(
  "serviceWorker" in navigator
){

  navigator.serviceWorker
    .register("/sw.js")
    .catch(()=>{});

}

start();
