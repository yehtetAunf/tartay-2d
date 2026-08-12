const ROUNDS=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
const grid=document.getElementById("historyGrid"), pick=document.getElementById("datePick"), text=document.getElementById("dateText");
function myToday(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return `${g("year")}-${g("month")}-${g("day")}`}
function fmt(d){const [y,m,day]=d.split("-");return `${y}/${m}/${day}`}
function timeHTML(t){const a=t.split(" ");return `${a[0]}\n${a[1]}`}
async function load(date){
 text.textContent=fmt(date); pick.value=date;
 grid.innerHTML=ROUNDS.map(t=>`<div class="round"><div class="rtime">${timeHTML(t)}</div><div class="rbox">--</div></div>`).join("");
 try{
   const r=await fetch(`/api/results/history?date=${encodeURIComponent(date)}&days=1&limit=50&t=${Date.now()}`,{cache:"no-store"});
   const d=await r.json(); if(!r.ok)throw new Error(d.error||"History load failed");
   const rows=(Array.isArray(d.results)?d.results:[]).filter(x=>x.result_date===date);
   const map=new Map(rows.map(x=>[x.round_time,x.result_2d||"--"]));
   [...grid.querySelectorAll(".rbox")].forEach((el,i)=>el.textContent=map.get(ROUNDS[i])||"--");
 }catch(e){}
}
document.getElementById("calBtn").onclick=()=>{try{pick.showPicker()}catch(e){pick.click()}};
pick.onchange=()=>pick.value&&load(pick.value);
load(myToday());