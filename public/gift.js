const dailyView=document.getElementById("dailyView"), weeklyView=document.getElementById("weeklyView");
const dailyBtn=document.getElementById("dailyBtn"), weeklyBtn=document.getElementById("weeklyBtn");
function myToday(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t)?.value||"";return `${g("year")}-${g("month")}-${g("day")}`}
function fmt(d){if(!d)return "--";const [y,m,day]=d.split("-");return `${day}.${m}.${y}`}
function weeklyRange(d){
  if(!d)return "--";
  const [y,m,day]=d.split("-").map(Number);
  const base=new Date(Date.UTC(y,m-1,day));
  const weekday=base.getUTCDay();
  const mondayOffset=weekday===0?-6:1-weekday;
  const start=new Date(base);
  start.setUTCDate(base.getUTCDate()+mondayOffset);
  const end=new Date(start);
  end.setUTCDate(start.getUTCDate()+5);
  const iso=x=>`${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,"0")}-${String(x.getUTCDate()).padStart(2,"0")}`;
  return `${fmt(iso(start))} မှ ${fmt(iso(end))}`;
}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function setTab(kind){const daily=kind==="daily";dailyBtn.classList.toggle("active",daily);weeklyBtn.classList.toggle("active",!daily);dailyView.hidden=!daily;weeklyView.hidden=daily;if(daily)loadDaily();else loadWeekly()}
function dailyHtml(d){if(!d)return `<div class="gift-empty">ဒီနေ့အတွက် လက်ဆောင်ဂဏန်း မရှိသေးပါ။</div>`;const pairs=Array.isArray(d.pairs)?d.pairs:[];return `<div class="gift-card daily-card"><div class="gift-date">${fmt(d.date_from)}${d.date_to&&d.date_to!==d.date_from?`<br>${fmt(d.date_to)}`:""}</div><div class="gift-label">${esc(d.title||"တစ်ရက်စာ လက်ဆောင်ဂဏန်း")}</div><div class="daily-main">${esc(d.main_number||"--")}</div><div class="daily-pairs">${pairs.filter(Boolean).map(esc).join("<br>")}</div><div class="gift-note">${esc(d.note||"")}</div></div>`}
function weeklyHtml(d){if(!d)return `<div class="gift-empty">ဒီတစ်ပတ်အတွက် လက်ဆောင်ဂဏန်း မရှိသေးပါ။</div>`;const items=Array.isArray(d.items)?d.items:[];return `<div class="gift-card weekly-card"><div class="gift-date">${weeklyRange(d.week_date)}${d.title?`<br><span>${esc(d.title)}</span>`:""}</div><div class="gift-label">${esc(d.label||"နေ့တစ်ပတ်စာ လက်ဆောင်ဂဏန်း")}</div><div class="weekly-grid">${items.slice(0,4).map(x=>`<div class="weekly-box"><b>${esc(x.number||"--")}</b><span>${esc(x.pairs||"").replace(/\n/g,"<br>")}</span></div>`).join("")}</div><div class="gift-note">${esc(d.note||"")}</div></div>`}
async function loadDaily(){dailyView.innerHTML='<div class="gift-loading">Loading...</div>';try{const r=await fetch(`/api/gifts?kind=daily&date=${encodeURIComponent(myToday())}&t=${Date.now()}`,{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"Load failed");dailyView.innerHTML=dailyHtml(d.gift)}catch(e){dailyView.innerHTML='<div class="gift-empty">လက်ဆောင်ဂဏန်း မဖတ်နိုင်သေးပါ။</div>'}}
async function loadWeekly(){weeklyView.innerHTML='<div class="gift-loading">Loading...</div>';try{const r=await fetch(`/api/gifts?kind=weekly&date=${encodeURIComponent(myToday())}&t=${Date.now()}`,{cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"Load failed");weeklyView.innerHTML=weeklyHtml(d.gift)}catch(e){weeklyView.innerHTML='<div class="gift-empty">လက်ဆောင်ဂဏန်း မဖတ်နိုင်သေးပါ။</div>'}}
dailyBtn.onclick=()=>setTab("daily");weeklyBtn.onclick=()=>setTab("weekly");loadDaily();
