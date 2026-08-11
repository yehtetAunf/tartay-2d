
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
    const r=await fetch(`/api/today?date=${encodeURIComponent(date)}&t=${Date.now()}`,{cache:"no-store"});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||"Load failed");
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
      const r=await fetch("/api/admin/save",{
        method:"POST",
        headers:{"content-type":"application/json","authorization":`Bearer ${token}`},
        body:JSON.stringify({result_date:date,round_time:el.dataset.time,result_2d:v})
      });
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||`Save failed: ${el.dataset.time}`);
    }
    $("saveMsg").textContent="Saved.";
    await loadDate();
  }catch(e){$("saveMsg").textContent=e.message}
}
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
