interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface LoginBody { username?: string; password?: string; }
interface BetBody { customer_name?: string; phone?: string; number?: string; amount?: number | string; bet_type?: string; }
interface ResultBody { result_date?: string; result_time?: string; set_value?: string; market_value?: string; result_number?: string; }

const RESULT_TIMES = ["5:00 PM","6:00 PM","7:00 PM","8:00 PM","9:00 PM","10:00 PM","11:00 PM","12:00 AM"] as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: {"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"} });
}
function validTime(v: string): boolean { return RESULT_TIMES.includes(v as typeof RESULT_TIMES[number]); }
function todayMyanmar(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=(t:string)=>parts.find(p=>p.type===t)?.value||"";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
async function ensureResultTable(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS result_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_date TEXT NOT NULL,
    result_time TEXT NOT NULL,
    set_value TEXT NOT NULL DEFAULT '--',
    market_value TEXT NOT NULL DEFAULT '--',
    result_number TEXT NOT NULL DEFAULT '--',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(result_date, result_time)
  )`).run();
}
async function ensureDay(db: D1Database, date: string): Promise<void> {
  await ensureResultTable(db);
  const statements = RESULT_TIMES.map(time => db.prepare(
    `INSERT OR IGNORE INTO result_records (result_date,result_time) VALUES (?,?)`
  ).bind(date,time));
  await db.batch(statements);
}
const orderSql = `CASE result_time
 WHEN '5:00 PM' THEN 1 WHEN '6:00 PM' THEN 2 WHEN '7:00 PM' THEN 3 WHEN '8:00 PM' THEN 4
 WHEN '9:00 PM' THEN 5 WHEN '10:00 PM' THEN 6 WHEN '11:00 PM' THEN 7 WHEN '12:00 AM' THEN 8 ELSE 99 END`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/login" && request.method === "POST") {
      let body: LoginBody;
      try { body = await request.json<LoginBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const username=body.username?.trim(), password=body.password;
      if(!username||!password) return json({success:false,message:"Username and password are required"},400);
      const user=await env.DB.prepare(`SELECT id,username,password_hash,full_name,role,status FROM users WHERE username=? LIMIT 1`).bind(username).first<any>();
      if(!user||user.status!==1||user.password_hash!==password) return json({success:false,message:"Invalid username or password"},401);
      return json({success:true,message:"Login successful",user:{id:user.id,username:user.username,full_name:user.full_name,role:user.role}});
    }

    if (url.pathname === "/api/bets" && request.method === "GET") {
      const bets=await env.DB.prepare(`SELECT id,customer_name,phone,number,amount,bet_type,status,created_at FROM bets ORDER BY id DESC`).all();
      return json({success:true,bets:bets.results});
    }
    if (url.pathname === "/api/bets" && request.method === "POST") {
      let body: BetBody; try { body=await request.json<BetBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const customer=body.customer_name?.trim(), phone=body.phone?.trim()||"", number=body.number?.trim(), amount=Number(body.amount), time=body.bet_type?.trim();
      if(!customer||!number||!time) return json({success:false,message:"Customer, number and result time are required"},400);
      if(!/^\d{2}$/.test(number)) return json({success:false,message:"2D Number must contain exactly 2 digits"},400);
      if(!validTime(time)) return json({success:false,message:"Invalid result time"},400);
      if(!Number.isInteger(amount)||amount<=0) return json({success:false,message:"Amount must be a positive whole number"},400);
      const result=await env.DB.prepare(`INSERT INTO bets(customer_name,phone,number,amount,bet_type) VALUES(?,?,?,?,?)`).bind(customer,phone,number,amount,time).run();
      return json({success:true,message:"Bet saved successfully",bet_id:result.meta.last_row_id},201);
    }

    if (url.pathname === "/api/results" && request.method === "GET") {
      const date=url.searchParams.get("date")||todayMyanmar();
      await ensureDay(env.DB,date);
      const rows=await env.DB.prepare(`SELECT id,result_date,result_time,set_value,market_value,result_number,updated_at FROM result_records WHERE result_date=? ORDER BY ${orderSql}`).bind(date).all();
      return json({success:true,date,results:rows.results});
    }
    if (url.pathname === "/api/results/history" && request.method === "GET") {
      await ensureResultTable(env.DB);
      const dates=await env.DB.prepare(`SELECT DISTINCT result_date FROM result_records WHERE result_number!='--' ORDER BY result_date DESC LIMIT 60`).all();
      return json({success:true,dates:dates.results});
    }
    if (url.pathname === "/api/results" && request.method === "POST") {
      let body: ResultBody; try { body=await request.json<ResultBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const date=body.result_date?.trim()||todayMyanmar(), time=body.result_time?.trim(), setValue=body.set_value?.trim()||"--", marketValue=body.market_value?.trim()||"--", number=body.result_number?.trim();
      if(!time||!validTime(time)) return json({success:false,message:"Invalid result time"},400);
      if(!number||!/^\d{2}$/.test(number)) return json({success:false,message:"Result number must contain exactly 2 digits"},400);
      await ensureDay(env.DB,date);
      await env.DB.prepare(`UPDATE result_records SET set_value=?,market_value=?,result_number=?,updated_at=CURRENT_TIMESTAMP WHERE result_date=? AND result_time=?`).bind(setValue,marketValue,number,date,time).run();
      return json({success:true,message:"Result updated successfully"});
    }

    if(url.pathname.startsWith("/api/")) return json({success:false,message:"Not Found"},404);
    return env.ASSETS.fetch(request);
  }
};
