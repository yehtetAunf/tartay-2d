const u=document.getElementById("username"),p=document.getElementById("password"),b=document.getElementById("loginButton"),m=document.getElementById("message");
b.addEventListener("click",login);p.addEventListener("keydown",e=>{if(e.key==="Enter")login()});
async function login(){const username=u.value.trim(),password=p.value;if(!username||!password){m.textContent="Username and password are required.";return}
b.disabled=true;b.textContent="Logging in...";m.textContent="";
try{const r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});const d=await r.json();
if(!r.ok||!d.success){m.textContent=d.message||"Login failed.";return}
sessionStorage.setItem("tartay_user",JSON.stringify(d.user));location.href="/dashboard.html";
}catch{m.textContent="Network error. Please try again."}finally{b.disabled=false;b.textContent="Login"}}
