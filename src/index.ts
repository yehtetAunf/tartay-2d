interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface LoginBody { username?: string; password?: string; }
interface BetBody { customer_name?: string; phone?: string; number?: string; amount?: number | string; bet_type?: string; }
interface ResultBody { result_date?: string; result_time?: string; set_value?: string; market_value?: string; result_number?: string; }
interface CustomerBody { username?: string; password?: string; full_name?: string; phone?: string; }
interface WalletBody { customer_id?: number | string; type?: string; amount?: number | string; note?: string; }
interface StatusBody { status?: string; }
interface CustomerLoginBody { username?: string; password?: string; }
interface CustomerBetBody { number?: string; amount?: number | string; result_time?: string; }

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

async function ensureV23(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS customer_sessions (token TEXT PRIMARY KEY, customer_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL)`).run();
  const cols=await db.prepare(`PRAGMA table_info(bets)`).all<any>();
  const names=new Set((cols.results||[]).map((x:any)=>x.name));
  if(!names.has("customer_id")) await db.prepare(`ALTER TABLE bets ADD COLUMN customer_id INTEGER`).run();
  if(!names.has("bet_date")) await db.prepare(`ALTER TABLE bets ADD COLUMN bet_date TEXT`).run();
}
function bearer(request: Request): string {
  const h=request.headers.get("Authorization")||"";
  return h.startsWith("Bearer ")?h.slice(7).trim():"";
}
async function currentCustomer(request: Request, db: D1Database): Promise<any|null> {
  await ensureV23(db);
  const token=bearer(request); if(!token)return null;
  return db.prepare(`SELECT c.id,c.username,c.full_name,c.phone,c.balance,c.status FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token=? AND s.expires_at>CURRENT_TIMESTAMP LIMIT 1`).bind(token).first<any>();
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

    if (url.pathname === "/api/customer/login" && request.method === "POST") {
      await ensureV23(env.DB);
      let body: CustomerLoginBody; try { body=await request.json<CustomerLoginBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const username=body.username?.trim(), password=body.password;
      if(!username||!password) return json({success:false,message:"Username and password are required"},400);
      const c=await env.DB.prepare(`SELECT id,username,password_hash,full_name,phone,balance,status FROM customers WHERE username=? LIMIT 1`).bind(username).first<any>();
      if(!c||c.password_hash!==password) return json({success:false,message:"Invalid username or password"},401);
      if(c.status!=="active") return json({success:false,message:"This account is blocked"},403);
      const token=crypto.randomUUID()+crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO customer_sessions(token,customer_id,expires_at) VALUES(?,?,datetime('now','+30 days'))`).bind(token,c.id).run();
      return json({success:true,token,customer:{id:c.id,username:c.username,full_name:c.full_name,phone:c.phone,balance:c.balance}});
    }
    if (url.pathname === "/api/customer/me" && request.method === "GET") {
      const c=await currentCustomer(request,env.DB);
      if(!c)return json({success:false,message:"Please login"},401);
      return json({success:true,customer:c});
    }
    if (url.pathname === "/api/customer/logout" && request.method === "POST") {
      const token=bearer(request); if(token) await env.DB.prepare(`DELETE FROM customer_sessions WHERE token=?`).bind(token).run();
      return json({success:true});
    }
    if (url.pathname === "/api/customer/bets" && request.method === "GET") {
      const c=await currentCustomer(request,env.DB); if(!c)return json({success:false,message:"Please login"},401);
      const rows=await env.DB.prepare(`SELECT id,number,amount,bet_type,status,created_at FROM bets WHERE customer_id=? ORDER BY id DESC LIMIT 100`).bind(c.id).all();
      return json({success:true,bets:rows.results});
    }
    if (url.pathname === "/api/customer/bets" && request.method === "POST") {
      const c=await currentCustomer(request,env.DB); if(!c)return json({success:false,message:"Please login"},401);
      if(c.status!=="active")return json({success:false,message:"This account is blocked"},403);
      let body: CustomerBetBody; try { body=await request.json<CustomerBetBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const number=body.number?.trim(), amount=Number(body.amount), time=body.result_time?.trim();
      if(!number||!/^\d{2}$/.test(number))return json({success:false,message:"2D Number must contain exactly 2 digits"},400);
      if(!time||!validTime(time))return json({success:false,message:"Invalid result time"},400);
      if(!Number.isInteger(amount)||amount<=0)return json({success:false,message:"Amount must be a positive whole number"},400);
      const date=todayMyanmar(); await ensureDay(env.DB,date);
      const published=await env.DB.prepare(`SELECT result_number FROM result_records WHERE result_date=? AND result_time=? LIMIT 1`).bind(date,time).first<any>();
      if(published && /^\d{2}$/.test(published.result_number))return json({success:false,message:"This result time is already closed"},400);
      const fresh=await env.DB.prepare(`SELECT balance FROM customers WHERE id=?`).bind(c.id).first<any>();
      const before=Number(fresh?.balance||0); if(before<amount)return json({success:false,message:"Insufficient balance"},400);
      const after=before-amount;
      const batch=await env.DB.batch([
        env.DB.prepare(`UPDATE customers SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND balance=?`).bind(after,c.id,before),
        env.DB.prepare(`INSERT INTO bets(customer_id,customer_name,phone,number,amount,bet_type,status,bet_date) VALUES(?,?,?,?,?,?,?,?)`).bind(c.id,c.full_name,c.phone||"",number,amount,time,"pending",date),
        env.DB.prepare(`INSERT INTO wallet_transactions(customer_id,type,amount,balance_before,balance_after,note) VALUES(?,?,?,?,?,?)`).bind(c.id,"bet",amount,before,after,`2D ${number} • ${time}`)
      ]);
      if((batch[0]?.meta?.changes||0)!==1)return json({success:false,message:"Balance changed. Please try again."},409);
      return json({success:true,message:"Bet placed successfully",balance:after,bet_id:batch[1]?.meta?.last_row_id},201);
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
      const betDate = todayMyanmar();
      await ensureDay(env.DB, betDate);
      const published = await env.DB.prepare(`SELECT result_number FROM result_records WHERE result_date=? AND result_time=? LIMIT 1`).bind(betDate,time).first<{result_number:string}>();
      const initialStatus = published && /^\d{2}$/.test(published.result_number)
        ? (published.result_number === number ? "win" : "lose")
        : "pending";
      const result=await env.DB.prepare(`INSERT INTO bets(customer_name,phone,number,amount,bet_type,status) VALUES(?,?,?,?,?,?)`).bind(customer,phone,number,amount,time,initialStatus).run();
      return json({success:true,message:"Bet saved successfully",bet_id:result.meta.last_row_id,status:initialStatus},201);
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
      // Prevent publishing the same time twice. This avoids duplicate wallet payouts.
      const existing = await env.DB.prepare(`SELECT result_number FROM result_records WHERE result_date=? AND result_time=? LIMIT 1`).bind(date,time).first<any>();
      if (existing && /^\d{2}$/.test(existing.result_number)) {
        return json({success:false,message:"This result time has already been published"},409);
      }

      // Get only pending bets for this date/time. Customer-app bets have customer_id.
      const pending = await env.DB.prepare(`SELECT id,customer_id,number,amount FROM bets WHERE bet_type=? AND status='pending' AND (bet_date=? OR (bet_date IS NULL AND DATE(created_at,'+6 hours','+30 minutes')=?)) ORDER BY id`).bind(time,date,date).all<any>();

      const statements: D1PreparedStatement[] = [
        env.DB.prepare(`UPDATE result_records SET set_value=?,market_value=?,result_number=?,updated_at=CURRENT_TIMESTAMP WHERE result_date=? AND result_time=?`).bind(setValue,marketValue,number,date,time)
      ];

      let betsUpdated = 0;
      let winners = 0;
      let totalPayout = 0;

      for (const bet of (pending.results || [])) {
        const isWin = String(bet.number) === number;
        statements.push(env.DB.prepare(`UPDATE bets SET status=? WHERE id=? AND status='pending'`).bind(isWin ? 'win' : 'lose', bet.id));
        betsUpdated++;

        // Admin-entered bets may not have a customer_id, so only wallet-credit customer-app bets.
        const customerId = Number(bet.customer_id);
        if (isWin && Number.isInteger(customerId) && customerId > 0) {
          const payout = Number(bet.amount) * 95;
          const customer = await env.DB.prepare(`SELECT balance FROM customers WHERE id=? LIMIT 1`).bind(customerId).first<any>();
          if (customer) {
            const before = Number(customer.balance || 0);
            const after = before + payout;
            statements.push(env.DB.prepare(`UPDATE customers SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(after,customerId));
            statements.push(env.DB.prepare(`INSERT INTO wallet_transactions(customer_id,type,amount,balance_before,balance_after,note) VALUES(?,?,?,?,?,?)`).bind(customerId,'win_payout',payout,before,after,`WIN 2D ${number} • ${time} • Bet #${bet.id}`));
            winners++;
            totalPayout += payout;
          }
        }
      }

      await env.DB.batch(statements);
      return json({success:true,message:"Result published successfully",bets_updated:betsUpdated,winners,total_payout:totalPayout});
    }

    if (url.pathname === "/api/customers" && request.method === "GET") {
      const rows=await env.DB.prepare(`SELECT id,username,full_name,phone,balance,status,created_at,updated_at FROM customers ORDER BY id DESC`).all();
      return json({success:true,customers:rows.results});
    }
    if (url.pathname === "/api/customers" && request.method === "POST") {
      let body: CustomerBody; try { body=await request.json<CustomerBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const username=body.username?.trim(), password=body.password, fullName=body.full_name?.trim(), phone=body.phone?.trim()||null;
      if(!username||!password||!fullName) return json({success:false,message:"Username, password and full name are required"},400);
      if(username.length<3) return json({success:false,message:"Username must be at least 3 characters"},400);
      if(password.length<4) return json({success:false,message:"Password must be at least 4 characters"},400);
      try {
        const r=await env.DB.prepare(`INSERT INTO customers(username,password_hash,full_name,phone) VALUES(?,?,?,?)`).bind(username,password,fullName,phone).run();
        return json({success:true,message:"Customer created successfully",customer_id:r.meta.last_row_id},201);
      } catch(e:any) { return json({success:false,message:"Username or phone already exists"},409); }
    }
    const customerStatusMatch=url.pathname.match(/^\/api\/customers\/(\d+)\/status$/);
    if(customerStatusMatch && request.method === "POST") {
      let body: StatusBody; try { body=await request.json<StatusBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const status=body.status?.trim().toLowerCase();
      if(status!=="active"&&status!=="blocked") return json({success:false,message:"Status must be active or blocked"},400);
      await env.DB.prepare(`UPDATE customers SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,Number(customerStatusMatch[1])).run();
      return json({success:true,message:"Customer status updated"});
    }
    if (url.pathname === "/api/wallet" && request.method === "POST") {
      let body: WalletBody; try { body=await request.json<WalletBody>(); } catch { return json({success:false,message:"Invalid JSON data"},400); }
      const customerId=Number(body.customer_id), type=body.type?.trim().toLowerCase(), amount=Number(body.amount), note=body.note?.trim()||"";
      if(!Number.isInteger(customerId)||customerId<=0) return json({success:false,message:"Invalid customer"},400);
      if(type!=="deposit"&&type!=="withdraw") return json({success:false,message:"Type must be deposit or withdraw"},400);
      if(!Number.isInteger(amount)||amount<=0) return json({success:false,message:"Amount must be a positive whole number"},400);
      const c=await env.DB.prepare(`SELECT id,balance FROM customers WHERE id=? LIMIT 1`).bind(customerId).first<any>();
      if(!c) return json({success:false,message:"Customer not found"},404);
      const before=Number(c.balance||0), after=type==="deposit"?before+amount:before-amount;
      if(after<0) return json({success:false,message:"Insufficient balance"},400);
      await env.DB.batch([
        env.DB.prepare(`UPDATE customers SET balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(after,customerId),
        env.DB.prepare(`INSERT INTO wallet_transactions(customer_id,type,amount,balance_before,balance_after,note) VALUES(?,?,?,?,?,?)`).bind(customerId,type,amount,before,after,note)
      ]);
      return json({success:true,message:type==="deposit"?"Deposit successful":"Withdraw successful",balance:after});
    }
    if (url.pathname === "/api/wallet/history" && request.method === "GET") {
      const customerId=Number(url.searchParams.get("customer_id"));
      if(!Number.isInteger(customerId)||customerId<=0) return json({success:false,message:"Invalid customer"},400);
      const rows=await env.DB.prepare(`SELECT id,customer_id,type,amount,balance_before,balance_after,note,created_at FROM wallet_transactions WHERE customer_id=? ORDER BY id DESC LIMIT 100`).bind(customerId).all();
      return json({success:true,transactions:rows.results});
    }

    if(url.pathname.startsWith("/api/")) return json({success:false,message:"Not Found"},404);
    return env.ASSETS.fetch(request);
  }
};
