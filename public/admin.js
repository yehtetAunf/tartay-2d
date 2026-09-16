
const ROUNDS=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
let token=localStorage.getItem("tartayAdminToken")||"";
const $=id=>document.getElementById(id);

function today(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function draw(results=[]){
  const m=new Map((results||[]).map(x=>[x.round_time,x]));
  $("adminRounds").innerHTML=ROUNDS.map(t=>{
    const v=m.get(t)?.result_2d||"";
    return `<div class="admin-round">
      <b>${t}</b>
      <input inputmode="numeric" maxlength="2" data-time="${t}" value="${v}" placeholder="--">
    </div>`;
  }).join("");
}
async function login(){
  try{
    $("loginMsg").textContent="Logging in...";
    const r=await fetch("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:$("password").value})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||"Login failed");
    token=d.token;
    localStorage.setItem("tartayAdminToken",token);
    $("loginBox").hidden=true;
    $("editor").hidden=false;
    $("loginMsg").textContent="";
    await loadDate();
  }catch(e){$("loginMsg").textContent=e.message}
}
async function loadDate(){
  draw([]); // eight rounds are always visible
  try{
    const date=$("resultDate").value;
    const r=await fetch(`/api/admin/state?date=${encodeURIComponent(date)}&t=${Date.now()}`,{cache:"no-store",headers:{"authorization":`Bearer ${token}`}});
    const d=await r.json();
    if(!r.ok){
      if(r.status===401){
        token="";
        localStorage.removeItem("tartayAdminToken");
        $("editor").hidden=true;
        $("loginBox").hidden=false;
        $("loginMsg").textContent="Password ဖြင့် ပြန် Login ဝင်ပါ။";
      }
      throw new Error(d.error||"Load failed");
    }
    draw(Array.isArray(d.results)?d.results:[]);
    $("saveMsg").textContent="";
  }catch(e){
    $("saveMsg").textContent=e.message;
  }
}
async function saveAll(){
  $("saveMsg").textContent="Saving...";
  const date=$("resultDate").value;
  const inputs=[...document.querySelectorAll(".admin-round input")];
  try{
    for(const el of inputs){
      const v=el.value.trim();
      if(!v) continue;
      if(!/^\d{2}$/.test(v)) throw new Error(`${el.dataset.time}: enter exactly 2 digits`);
      const r=await fetch("/api/admin/result",{
        method:"POST",
        headers:{"content-type":"application/json","authorization":`Bearer ${token}`},
        body:JSON.stringify({result_date:date,round_time:el.dataset.time,result_2d:v,publish_mode:"schedule",auto_publish:true})
      });
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||`Save failed: ${el.dataset.time}`);
    }
    $("saveMsg").textContent="Saved.";
    await loadDate();
  }catch(e){$("saveMsg").textContent=e.message}
}

function calc2DFromSetValue(setValue,valueValue){
  const s=String(setValue??"").trim();
  const v=String(valueValue??"").trim();
  const sd=s.replace(/\D/g,"");
  const integer=v.split(".")[0].replace(/\D/g,"");
  if(!sd||!integer)return "";
  return sd.slice(-1)+integer.slice(-1);
}
function updateToday2D(){
  $("today2D").value=calc2DFromSetValue($("todaySet").value,$("todayValue").value)||"";
}
async function saveTodayRound(mode){
  const round=$("todayRound").value;
  const setValue=$("todaySet").value.trim();
  const valueValue=$("todayValue").value.trim();
  const result2d=calc2DFromSetValue(setValue,valueValue);
  if(!setValue||!valueValue||!/^\d{2}$/.test(result2d)){
    $("todayMsg").textContent="SET / VALUE ကို မှန်ကန်စွာထည့်ပါ။";
    return;
  }
  const autoPublish=$("autoPublish").checked;
  try{
    $("todayMsg").textContent=mode==="now"?`Publishing ${round}...`:`Saving ${round} schedule...`;
    const r=await fetch("/api/admin/result",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":`Bearer ${token}`},
      body:JSON.stringify({
        result_date:$("resultDate").value,
        round_time:round,
        result_2d:result2d,
        set_value:setValue,
        value_value:valueValue,
        publish_mode:mode,
        auto_publish:autoPublish
      })
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Save failed");
    $("today2D").value=result2d;
    $("todayMsg").textContent=mode==="now"
      ?`${round} published now.`
      :`${round} schedule saved.${autoPublish?" Round အချိန်ရောက်မှ Auto Publish လုပ်မယ်။":" User ဘက်မှာ ဖျောက်ထားမယ်။"}`;
    await loadDate();
  }catch(e){$("todayMsg").textContent=e.message}
}
async function undoTodayRound(){
  const round=$("todayRound").value;
  try{
    $("todayMsg").textContent=`Hiding ${round}...`;
    const r=await fetch("/api/admin/unpublish",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":`Bearer ${token}`},
      body:JSON.stringify({result_date:$("resultDate").value,round_time:round})
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"Undo publish failed");
    $("autoPublish").checked=false;
    $("todayMsg").textContent=`${round} hidden. User ဘက်မှာ SET / VALUE / 2D ကို -- ပြမယ်။`;
    await loadDate();
  }catch(e){$("todayMsg").textContent=e.message}
}
$("todaySet").addEventListener("input",updateToday2D);
$("todayValue").addEventListener("input",updateToday2D);
$("saveSchedule").onclick=()=>saveTodayRound("schedule");
$("publishToday").onclick=()=>saveTodayRound("now");
$("undoPublish").onclick=undoTodayRound;


$("resultDate").value=today();
draw([]);
$("loginBtn").onclick=login;
$("loadDate").onclick=loadDate;
$("saveAll").onclick=saveAll;
$("password").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
if(token){
  $("loginBox").hidden=true;
  $("editor").hidden=false;
  loadDate();
}


// v8.4 Gift-number editor (isolated from the existing 2D result editor)
let giftKind="daily";
function giftSetTab(kind){giftKind=kind;$("giftDailyTab").classList.toggle("active",kind==="daily");$("giftWeeklyTab").classList.toggle("active",kind==="weekly");$("giftDailyEditor").hidden=kind!=="daily";$("giftWeeklyEditor").hidden=kind!=="weekly";$("giftMsg").textContent="";loadGift();}
function splitLines(v){return String(v||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean)}
function fillGift(g){if(giftKind==="daily"){$("giftDateFrom").value=g?.date_from||$("resultDate").value;$("giftDateTo").value=g?.date_to||$("giftDateFrom").value;$("giftMainNumber").value=g?.main_number||"";$("giftPairs").value=(g?.pairs||[]).join("\n");$("giftDailyTitle").value=g?.title||"တစ်ရက်စာ လက်ဆောင်ဂဏန်း";$("giftDailyNote").value=g?.note||"";}else{$("giftWeekDate").value=g?.week_date||$("resultDate").value;$("giftWeeklyLabel").value=g?.label||"နေ့တစ်ပတ်စာ လက်ဆောင်ဂဏန်း";const items=Array.isArray(g?.items)?g.items:[];for(let i=0;i<4;i++){$(`giftW${i+1}n`).value=items[i]?.number||"";$(`giftW${i+1}p`).value=items[i]?.pairs||""}$("giftWeeklyNote").value=g?.note||"";}}
async function loadGift(){if(!token)return;const date=giftKind==="daily"?$("giftDateFrom").value:$("giftWeekDate").value;if(!date)return;try{const r=await fetch(`/api/admin/gift?kind=${giftKind}&date=${encodeURIComponent(date)}&t=${Date.now()}`,{cache:"no-store",headers:{authorization:`Bearer ${token}`}});const d=await r.json();if(!r.ok)throw Error(d.error||"Load gift failed");fillGift(d.gift)}catch(e){$("giftMsg").textContent=e.message}}
async function saveGift(){try{const data=giftKind==="daily"?{date_from:$("giftDateFrom").value,date_to:$("giftDateTo").value||$("giftDateFrom").value,main_number:$("giftMainNumber").value.trim(),pairs:splitLines($("giftPairs").value),title:$("giftDailyTitle").value.trim(),note:$("giftDailyNote").value.trim()}:{week_date:$("giftWeekDate").value,label:$("giftWeeklyLabel").value.trim(),items:[1,2,3,4].map(i=>({number:$(`giftW${i}n`).value.trim(),pairs:$( `giftW${i}p`).value.trim()})),note:$("giftWeeklyNote").value.trim()};const period=giftKind==="daily"?data.date_from:data.week_date;if(!period)throw Error("Date ထည့်ပါ။");$("giftMsg").textContent="Saving...";const r=await fetch("/api/admin/gift",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({kind:giftKind,period_key:period,data})});const d=await r.json();if(!r.ok)throw Error(d.error||"Save gift failed");$("giftMsg").textContent="Gift saved.";fillGift(data)}catch(e){$("giftMsg").textContent=e.message}}
$("giftDailyTab").onclick=()=>giftSetTab("daily");$("giftWeeklyTab").onclick=()=>giftSetTab("weekly");$("giftLoad").onclick=loadGift;$("giftSave").onclick=saveGift;$("giftDateFrom").addEventListener("change",()=>{$("giftDateTo").value=$("giftDateTo").value||$("giftDateFrom").value;loadGift()});$("giftWeekDate").addEventListener("change",loadGift);$("giftDateFrom").value=today();$("giftDateTo").value=today();$("giftWeekDate").value=today();
