const ROUNDS=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
const host=document.getElementById("historySections"), pick=document.getElementById("datePick");
function myToday(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return `${g("year")}-${g("month")}-${g("day")}`}
function fmt(d){const [y,m,day]=d.split("-");return `${y}/${m}/${day}`}
function timeHTML(t){const a=t.split(" ");return `${a[0]}<br>${a[1]}`}
function section(date,rows){
 const map=new Map(rows.map(x=>[x.round_time,x.result_2d||"--"]));
 return `<section class="history-section" data-date="${date}">
   <div class="datebar"><span>▣</span><span>${fmt(date)}</span></div>
   <div class="hgrid">${ROUNDS.map(t=>`<div class="round"><div class="rtime">${timeHTML(t)}</div><div class="rbox">${map.get(t)||"--"}</div></div>`).join("")}</div>
 </section>`;
}
async function loadAll(){
 const today=myToday(); pick.value=today;
 try{
   const r=await fetch(`/api/results/history?date=${encodeURIComponent(today)}&days=365&limit=3000&t=${Date.now()}`,{cache:"no-store"});
   const d=await r.json(); if(!r.ok) throw new Error(d.error||"History load failed");
   const grouped=new Map();
   for(const row of (Array.isArray(d.results)?d.results:[])){
     if(!grouped.has(row.result_date)) grouped.set(row.result_date,[]);
     grouped.get(row.result_date).push(row);
   }
   const dates=[...grouped.keys()].sort((a,b)=>b.localeCompare(a));
   if(!dates.includes(today)) dates.unshift(today);
   host.innerHTML=dates.map(date=>section(date,grouped.get(date)||[])).join("");
 }catch(e){
   host.innerHTML=`<div class="datebar"><span>▣</span><span>${fmt(today)}</span></div><div class="hgrid">${ROUNDS.map(t=>`<div class="round"><div class="rtime">${timeHTML(t)}</div><div class="rbox">--</div></div>`).join("")}</div>`;
 }
}
document.getElementById("calBtn").onclick=()=>{try{pick.showPicker()}catch(e){pick.click()}};
pick.onchange=()=>{
 if(!pick.value)return;
 const el=document.querySelector(`[data-date="${pick.value}"]`);
 if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
};
loadAll();