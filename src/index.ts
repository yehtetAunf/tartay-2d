interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ================= HOME =================
    if (url.pathname === "/" && request.method === "GET") {
      const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Tartay 2D Login</title>
<style>
body{
margin:0;
font-family:Arial;
background:#0f172a;
display:flex;
justify-content:center;
align-items:center;
height:100vh;
color:white;
}
.box{
background:#1e293b;
padding:30px;
border-radius:12px;
width:320px;
}
input{
width:100%;
padding:12px;
margin:8px 0;
border-radius:6px;
border:none;
}
button{
width:100%;
padding:12px;
background:#2563eb;
color:white;
border:none;
border-radius:6px;
font-size:18px;
}
#msg{
margin-top:15px;
}
</style>
</head>
<body>

<div class="box">
<h2>Tartay 2D Admin Login</h2>

<input id="username" placeholder="Username">

<input id="password" type="password" placeholder="Password">

<button onclick="login()">Login</button>

<p id="msg"></p>
</div>

<script>
async function login(){

const res=await fetch("/login",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({
username:document.getElementById("username").value,
password:document.getElementById("password").value
})
});

const data=await res.json();

if(data.success){
location.href="/dashboard";
}else{
document.getElementById("msg").innerHTML=data.message;
}

}
</script>

</body>
</html>
`;

      return new Response(html, {
        headers: {
          "Content-Type": "text/html"
        }
      });
    }

    // ================= DASHBOARD =================

    if (url.pathname === "/dashboard") {

      const html=`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Dashboard</title>

<style>

body{
margin:0;
font-family:Arial;
background:#0f172a;
color:white;
}

header{
background:#2563eb;
padding:20px;
font-size:22px;
text-align:center;
}

.card{
margin:20px;
padding:20px;
background:#1e293b;
border-radius:10px;
}

button{
padding:10px 20px;
background:red;
color:white;
border:none;
border-radius:6px;
}

</style>

</head>

<body>

<header>
Tartay 2D Dashboard
</header>

<div class="card">
<h2>Welcome Owner</h2>

<p>System Online</p>

<button onclick="logout()">Logout</button>

</div>

<script>

function logout(){

location.href="/";

}

</script>

</body>

</html>
`;

      return new Response(html,{
        headers:{
          "Content-Type":"text/html"
        }
      });

    }

    // ================= USERS =================

    if (url.pathname === "/users") {

      const users=await env.DB.prepare(
      "SELECT id,username,full_name,role,status,created_at FROM users"
      ).all();

      return Response.json(users.results);

    }

    // ================= LOGIN =================

    if(url.pathname==="/login" && request.method==="POST"){

      const body=await request.json() as any;

      const user=await env.DB.prepare(
      "SELECT * FROM users WHERE username=? LIMIT 1"
      )
      .bind(body.username)
      .first<any>();

      if(!user){

        return Response.json({
          success:false,
          message:"User not found"
        });

      }

      if(user.password_hash!==body.password){

        return Response.json({
          success:false,
          message:"Wrong password"
        });

      }

      return Response.json({
        success:true,
        message:"Login successful"
      });

    }

    return new Response("Not Found",{status:404});

  }
};
