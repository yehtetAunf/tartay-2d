const f=document.getElementById("betForm"),s=document.getElementById("saveButton"),m=document.getElementById("formMessage");
if(!sessionStorage.getItem("tartay_user"))location.href="/";
f.addEventListener("submit",async e=>{e.preventDefault();const customer_name=document.getElementById("customerName").value.trim(),phone=document.getElementById("phone").value.trim(),number=document.getElementById("number").value.trim(),amount=Number(document.getElementById("amount").value),bet_type=document.getElementById("betType").value;
if(!/^\d{2}$/.test(number)){show("2D Number must contain exactly 2 digits.",false);return}
s.disabled=true;s.textContent="Saving...";
try{const r=await fetch("/api/bets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customer_name,phone,number,amount,bet_type})});const d=await r.json();
if(!r.ok||!d.success){show(d.message||"Bet could not be saved.",false);return}
show(`Bet saved successfully. ID: ${d.bet_id}`,true);f.reset();await loadBets();
}catch{show("Network error. Please try again.",false)}finally{s.disabled=false;s.textContent="Save Bet"}});
function show(t,ok){m.textContent=t;m.className=`message ${ok?"success":"error"}`}
async function loadBets(){const tb=document.getElementById("betTableBody");tb.innerHTML='<tr><td colspan="8" class="empty-row">Loading...</td></tr>';
try{const r=await fetch("/api/bets"),d=await r.json();if(!r.ok||!d.success)throw new Error();const bets=Array.isArray(d.bets)?d.bets:[];summary(bets);
if(!bets.length){tb.innerHTML='<tr><td colspan="8" class="empty-row">No bets found.</td></tr>';return}
tb.innerHTML=bets.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.customer_name)}</td><td>${esc(x.phone||"-")}</td><td>${esc(x.number)}</td><td>${fmt(x.amount)}</td><td>${esc(x.bet_type)}</td><td>${esc(x.status)}</td><td>${esc(x.created_at)}</td></tr>`).join("");
}catch{tb.innerHTML='<tr><td colspan="8" class="empty-row">Bet list could not be loaded.</td></tr>'}}
function summary(b){document.getElementById("totalBets").textContent=b.length.toLocaleString();document.getElementById("totalAmount").textContent=fmt(b.reduce((a,x)=>a+Number(x.amount||0),0));document.getElementById("totalCustomers").textContent=new Set(b.map(x=>String(x.customer_name||"").trim()).filter(Boolean)).size.toLocaleString()}
function fmt(v){return Number(v||0).toLocaleString()}function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function logout(){sessionStorage.removeItem("tartay_user");location.href="/"}loadBets();
