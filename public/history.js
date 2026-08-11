
const ROUNDS=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
const host=document.getElementById("historySections");
function ymdd(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function myToday(){
 const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const g=t=>p.find(x=>x.type===t)?.value||""; return `${g("year")}-${g("month")}-${g("day")}`;
}
function label(s){const [y,m,d]=s.split("-").map(Number);return new Intl.DateTimeFormat("en-US",{weekday:"short",year:"numeric",month:"long",day:"numeric"}).format(new Date(y,m-1,d))}
async function getDay(date){
 try{const r=await fetch(`/api/results/today?date=${date}&t=${Date.now()}`,{cache:"no-store"});const d=await r.json();return Array.isArray(d.results)?d.results:[]}catch{return []}
}
function section(date,results){
 const map=new Map(results.map(x=>[x.round_time,x]));
 return `<section class="history-day"><h2>${label(date)}</h2><div class="history-grid">${
  ROUNDS.map(t=>`<div class="history-card"><span class="history-time">${t}</span><strong class="history-result">${map.get(t)?.result_2d||"--"}</strong></div>`).join("")
 }</div></section>`;
}
async function load(){
 const today=myToday(), [y,m,d]=today.split("-").map(Number);
 const dates=[]; for(let i=0;i<14;i++){const x=new Date(y,m-1,d-i);dates.push(ymdd(x))}
 const chunks=[];
 for(const date of dates){const results=await getDay(date); if(date===today||results.length)chunks.push(section(date,results))}
 host.innerHTML=chunks.join("");
}
load();
