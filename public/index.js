const ROUNDS = [
  "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM",
  "09:00 PM", "10:00 PM", "11:00 PM", "12:00 AM"
];

const ROUND_RELEASE_HOURS = {
  "05:00 PM": 17, "06:00 PM": 18, "07:00 PM": 19, "08:00 PM": 20,
  "09:00 PM": 21, "10:00 PM": 22, "11:00 PM": 23, "12:00 AM": 24
};

const RESULT_HOLD_SECONDS = 120;
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MAX_BACKUP_ROWS = 5000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function formatDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateUTC(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function shiftDateText(value, days) {
  const d = parseDateUTC(value);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUTC(d);
}

function getMyanmarNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Yangon",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const n = type => Number(parts.find(p => p.type === type)?.value || 0);
  return { year: n("year"), month: n("month"), day: n("day"), hour: n("hour"), minute: n("minute"), second: n("second") };
}

function getOperationalDate() {
  const now = getMyanmarNow();
  const date = new Date(Date.UTC(now.year, now.month - 1, now.day));

  // Daily screen reset rule (Myanmar time):
  // 12:00 AM is the 8th/final round of the previous result day.
  // Keep that previous day visible only through 12:14:59 AM.
  // At 12:15 AM, switch to the new calendar/result day so all 8
  // rounds start fresh as -- until their new results are released.
  if (now.hour === 0 && now.minute < 15) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return formatDateUTC(date);
}

function myanmarPseudoEpoch(parts = getMyanmarNow()) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function roundReleasePseudoEpoch(resultDate, roundTime) {
  const base = parseDateUTC(resultDate);
  if (!base || !ROUNDS.includes(roundTime)) return NaN;
  let hour = ROUND_RELEASE_HOURS[roundTime];
  if (roundTime === "12:00 AM") {
    base.setUTCDate(base.getUTCDate() + 1);
    hour = 0;
  }
  return Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, 0, 0);
}

function isRoundReleased(resultDate, roundTime) {
  const release = roundReleasePseudoEpoch(resultDate, roundTime);
  return Number.isFinite(release) && myanmarPseudoEpoch() >= release;
}

function normaliseMode(value) {
  const mode = String(value || "").toLowerCase();
  if (mode === "now" || mode === "publish" || mode === "published") return "now";
  return "schedule";
}

function isResultPublic(item) {
  if (!item) return false;
  const mode = normaliseMode(item.publish_mode);
  if (mode === "now" || item.published_at) return true;
  if (Number(item.auto_publish ?? 1) !== 1) return false;
  return isRoundReleased(item.result_date, item.round_time);
}

function stableHash(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Tartay-generated display values. These are simulated app values, not market data.
// They are deterministic per date + round, so a released row never changes on refresh.
function generatedRoundValues(resultDate, roundTime) {
  const h1 = stableHash(`${resultDate}|${roundTime}|SET`);
  const h2 = stableHash(`${resultDate}|${roundTime}|VALUE`);
  const set = 10000 + (h1 % 900000) / 100;       // 10000.00 - 18999.99
  const value = 100000 + (h2 % 9000000);         // 100000 - 9099999
  return {
    set: set.toFixed(2),
    value: String(value)
  };
}

function publicResult(item) {
  return {
    id: item.id,
    result_date: item.result_date,
    round_time: item.round_time,
    result_2d: item.result_2d,
    set_value: item.set_value || "--",
    value_value: item.value_value || "--",
    updated_at: item.updated_at,
    published_at: item.published_at || (isRoundReleased(item.result_date, item.round_time) ? item.updated_at : null)
  };
}

function roundOrderSql(direction = "ASC") {
  return `CASE round_time
    WHEN '05:00 PM' THEN 1 WHEN '06:00 PM' THEN 2 WHEN '07:00 PM' THEN 3 WHEN '08:00 PM' THEN 4
    WHEN '09:00 PM' THEN 5 WHEN '10:00 PM' THEN 6 WHEN '11:00 PM' THEN 7 WHEN '12:00 AM' THEN 8
    ELSE 99 END ${direction}`;
}

async function ensureSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    context TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_round_locks (
    lock_key TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function logAdmin(env, action, details = {}) {
  try {
    await ensureSchema(env);
    await env.DB.prepare(`INSERT INTO app_admin_logs(action, details) VALUES(?, ?)`).bind(action, JSON.stringify(details)).run();
  } catch (e) { console.error("admin log", e); }
}

async function logError(env, error, context = {}) {
  try {
    await ensureSchema(env);
    await env.DB.prepare(`INSERT INTO app_error_logs(message, context) VALUES(?, ?)`).bind(String(error?.stack || error), JSON.stringify(context)).run();
  } catch (e) { console.error("error log", e); }
}

async function acquireRoundLock(env, date, round) {
  await ensureSchema(env);
  const key = `${date}|${round}`;
  const now = Date.now();
  await env.DB.prepare(`DELETE FROM app_round_locks WHERE expires_at < ?`).bind(now).run();
  try {
    await env.DB.prepare(`INSERT INTO app_round_locks(lock_key, expires_at) VALUES(?, ?)`).bind(key, now + 15000).run();
    return key;
  } catch { return null; }
}

async function releaseRoundLock(env, key) {
  if (!key) return;
  try { await env.DB.prepare(`DELETE FROM app_round_locks WHERE lock_key = ?`).bind(key).run(); } catch {}
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  value = value.replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
async function signingKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function createAdminToken(secret) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ role: "admin", exp: Math.floor(Date.now()/1000)+TOKEN_TTL_SECONDS })));
  const sig = await crypto.subtle.sign("HMAC", await signingKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(sig))}`;
}
async function verifyAdminToken(token, secret) {
  try {
    if (!token || !secret) return false;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const ok = await crypto.subtle.verify("HMAC", await signingKey(secret), base64UrlDecode(sig), new TextEncoder().encode(payload));
    if (!ok) return false;
    const data = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    return data.role === "admin" && Number(data.exp) >= Math.floor(Date.now()/1000);
  } catch { return false; }
}
async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") && verifyAdminToken(auth.slice(7).trim(), env.ADMIN_PASSWORD);
}
async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function clean2D(value) {
  const v = String(value ?? "").trim();
  return /^\d{2}$/.test(v) ? v : null;
}

function getNextRoundInfo(date = getOperationalDate()) {
  const nowMs = myanmarPseudoEpoch();

  // First look for the next round in the current Tartay operational day.
  for (const round of ROUNDS) {
    const releaseMs = roundReleasePseudoEpoch(date, round);
    if (releaseMs > nowMs) {
      return {
        result_date: date,
        round_time: round,
        release_ms: releaseMs,
        seconds_until: Math.ceil((releaseMs - nowMs) / 1000)
      };
    }
  }

  // After the 12:00 AM final round, keep the big 2D playing
  // toward the next operational day's 05:00 PM round.
  const nextDate = shiftDateText(date, 1);
  const round = ROUNDS[0];
  const releaseMs = roundReleasePseudoEpoch(nextDate, round);

  return {
    result_date: nextDate,
    round_time: round,
    release_ms: releaseMs,
    seconds_until: Math.max(0, Math.ceil((releaseMs - nowMs) / 1000))
  };
}

function buildPreSpinFrame(seed) {
  let x = 2166136261;
  for (let i=0;i<seed.length;i++) { x ^= seed.charCodeAt(i); x = Math.imul(x, 16777619); }
  const n = Math.abs(x % 100);
  return String(n).padStart(2, "0");
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body || typeof body.password !== "string") return json({success:false,error:"Password is required."},400);
  if (!env.ADMIN_PASSWORD) return json({success:false,error:"ADMIN_PASSWORD secret is not configured."},500);
  if (body.password !== env.ADMIN_PASSWORD) return json({success:false,error:"Invalid password."},401);
  await logAdmin(env, "login_success");
  return json({success:true, token:await createAdminToken(env.ADMIN_PASSWORD), expires_in:TOKEN_TTL_SECONDS});
}

async function handleSaveResult(request, env) {
  if (!(await requireAdmin(request, env))) return json({success:false,error:"Unauthorized."},401);
  const body = await readJson(request);
  if (!body) return json({success:false,error:"Invalid JSON body."},400);
  const resultDate = String(body.result_date || getOperationalDate()).trim();
  const roundTime = String(body.round_time || "").trim();
  const result2d = clean2D(body.result_2d);
  if (!parseDateUTC(resultDate)) return json({success:false,error:"Invalid result_date."},400);
  if (!ROUNDS.includes(roundTime)) return json({success:false,error:"Invalid round_time."},400);
  if (!result2d) return json({success:false,error:"result_2d must be exactly 2 digits."},400);
  const setValue = body.set_value == null ? null : String(body.set_value).trim();
  const valueValue = body.value_value == null ? null : String(body.value_value).trim();
  const publishMode = normaliseMode(body.publish_mode);
  const autoPublish = (body.auto_publish === false || body.auto_publish === 0) ? 0 : 1;
  const publishedAt = publishMode === "now" ? new Date().toISOString() : null;
  const lock = await acquireRoundLock(env, resultDate, roundTime);
  if (!lock) return json({success:false,error:"This round is temporarily locked. Please try again."},409);
  try {
    await env.DB.prepare(`INSERT INTO app_results(
      result_date,round_time,result_2d,set_value,value_value,publish_mode,auto_publish,published_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(result_date,round_time) DO UPDATE SET
      result_2d=excluded.result_2d,set_value=excluded.set_value,value_value=excluded.value_value,
      publish_mode=excluded.publish_mode,auto_publish=excluded.auto_publish,published_at=excluded.published_at,
      updated_at=CURRENT_TIMESTAMP`).bind(resultDate,roundTime,result2d,setValue,valueValue,publishMode,autoPublish,publishedAt).run();
    await logAdmin(env, publishMode === "now" ? "publish_now" : "save_schedule", {result_date:resultDate,round_time:roundTime,result_2d:result2d,auto_publish:autoPublish});
    return json({success:true, mode:publishMode, public:publishMode === "now" || (autoPublish === 1 && isRoundReleased(resultDate,roundTime)), result:{result_date:resultDate,round_time:roundTime,result_2d:result2d,set_value:setValue,value_value:valueValue,publish_mode:publishMode,auto_publish:autoPublish,published_at:publishedAt}});
  } finally { await releaseRoundLock(env, lock); }
}

async function handleUnpublish(request, env) {
  if (!(await requireAdmin(request, env))) return json({success:false,error:"Unauthorized."},401);
  const body = await readJson(request);
  const date = String(body?.result_date || getOperationalDate());
  const round = String(body?.round_time || "");
  if (!parseDateUTC(date) || !ROUNDS.includes(round)) return json({success:false,error:"Invalid date or round."},400);
  await env.DB.prepare(`UPDATE app_results SET publish_mode='schedule', auto_publish=0, published_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE result_date=? AND round_time=?`).bind(date,round).run();
  await logAdmin(env,"unpublish",{result_date:date,round_time:round});
  return json({success:true});
}

async function queryResultsForDate(env, date, includePrivate = false) {
  const res = await env.DB.prepare(`SELECT * FROM app_results WHERE result_date=? ORDER BY ${roundOrderSql("ASC")}`).bind(date).all();
  const rows = res.results || [];
  return includePrivate ? rows : rows.filter(isResultPublic).map(publicResult);
}

async function handleToday(url, env) {
  const date = url.searchParams.get("date") || getOperationalDate();
  if (!parseDateUTC(date)) return json({success:false,error:"Invalid date."},400);
  const results = await queryResultsForDate(env,date,false);
  return json({success:true,date,rounds:ROUNDS,serverNow:Date.now(),myanmarNow:getMyanmarNow(),nextRound:getNextRoundInfo(date),results});
}


async function fetchLiveMarket() {
  const endpoint = "https://api.exchange.coinbase.com/products/BTC-USD/ticker";
  try {
    const cache = caches.default;
    const cacheKey = new Request("https://tartay.local/cache/btc-usd-ticker");
    let response = await cache.match(cacheKey);
    if (!response) {
      const upstream = await fetch(endpoint, { headers: { "Accept": "application/json", "User-Agent": "Tartay-2D/3.3" } });
      if (!upstream.ok) throw new Error(`Market API HTTP ${upstream.status}`);
      const data = await upstream.json();
      response = new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=10" } });
      await cache.put(cacheKey, response.clone());
    }
    const data = await response.json();
    const price = Number(data.price);
    const volume = Number(data.volume);
    return {
      ok: Number.isFinite(price) && Number.isFinite(volume),
      set: Number.isFinite(price) ? price.toFixed(2) : "--",
      value: Number.isFinite(volume) ? volume.toFixed(2) : "--",
      source: "Coinbase BTC-USD",
      fetched_at: new Date().toISOString()
    };
  } catch (error) {
    console.error("Market API error", error);
    return { ok:false, set:"--", value:"--", source:"Coinbase BTC-USD" };
  }
}


async function lockReleasedMarketValues(env, date, market) {
  if (!market?.ok) return;
  try {
    const rows = await queryResultsForDate(env, date, true);
    for (const item of rows) {
      if (!isRoundReleased(item)) continue;
      if (item.set_value && item.value_value) continue;
      await env.DB.prepare(`
        UPDATE app_results
        SET set_value = COALESCE(NULLIF(set_value,''), ?),
            value_value = COALESCE(NULLIF(value_value,''), ?),
            updated_at = COALESCE(updated_at, ?)
        WHERE id = ?
      `).bind(market.set, market.value, new Date().toISOString(), item.id).run();
    }
  } catch (error) {
    console.error("Market lock error", error);
  }
}

async function handleState(env) {
  const date = getOperationalDate();
  const market = await fetchLiveMarket();

  // As soon as a round is released, freeze the current Coinbase SET/VALUE
  // into that round so refreshes/history never change it afterward.
  await lockReleasedMarketValues(env, date, market);
  const results = await queryResultsForDate(env, date, false);
  const nowMs = myanmarPseudoEpoch();

  // For exactly 2 minutes after a round's scheduled release time,
  // freeze the big 2D on that round's real result and show the check mark.
  let resultHold = null;

  for (let i = ROUNDS.length - 1; i >= 0; i--) {
    const roundTime = ROUNDS[i];
    const releaseMs = roundReleasePseudoEpoch(date, roundTime);
    const elapsedSeconds = Math.floor((nowMs - releaseMs) / 1000);

    if (elapsedSeconds >= 0 && elapsedSeconds < RESULT_HOLD_SECONDS) {
      const row = results.find(item => item.round_time === roundTime);

      if (row) {
        resultHold = {
          active: true,
          round_time: roundTime,
          result_2d: row.result_2d,
          elapsed_seconds: elapsedSeconds,
          seconds_remaining: RESULT_HOLD_SECONDS - elapsedSeconds,
          hold_until_ms: releaseMs + (RESULT_HOLD_SECONDS * 1000)
        };
      }
      break;
    }
  }

  const nextRound = getNextRoundInfo(date);
  let preSpin = null;

  // Outside the 2-minute result hold, the big 2D keeps playing
  // continuously until the next scheduled round time.
  if (!resultHold && nextRound && nextRound.seconds_until > 0) {
    const tick = Math.floor(Date.now() / 5000);
    preSpin = {
      active: true,
      result_date: nextRound.result_date,
      round_time: nextRound.round_time,
      seconds_until: nextRound.seconds_until,
      frame: buildPreSpinFrame(`${nextRound.result_date}|${nextRound.round_time}|${tick}`)
    };
  }

  return json({
    success: true,
    app: "Tartay 2D",
    version: "6.4.0",
    operational_date: date,
    serverNow: Date.now(),
    myanmarNow: getMyanmarNow(),
    nextRound,
    resultHold,
    preSpin,
    market,
    rounds: ROUNDS,
    results
  });
}

async function handleHistory(url, env) {
  let limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const date = url.searchParams.get("date");
  const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days") || 14)));
  let rows = [];
  if (date && parseDateUTC(date)) {
    const dates = Array.from({length:days},(_,i)=>shiftDateText(date,-i));
    const placeholders = dates.map(()=>"?").join(",");
    const res = await env.DB.prepare(`SELECT * FROM app_results WHERE result_date IN (${placeholders}) ORDER BY result_date DESC, ${roundOrderSql("ASC")} LIMIT ?`).bind(...dates,limit).all();
    rows = res.results || [];
  } else {
    const res = await env.DB.prepare(`SELECT * FROM app_results ORDER BY result_date DESC, ${roundOrderSql("ASC")} LIMIT 500`).all();
    rows = (res.results || []).slice(0,limit);
  }
  return json({success:true,serverNow:Date.now(),results:rows.filter(isResultPublic).map(publicResult)});
}

async function handleAdminState(request, env) {
  if (!(await requireAdmin(request, env))) return json({success:false,error:"Unauthorized."},401);
  const date = new URL(request.url).searchParams.get("date") || getOperationalDate();
  const results = await queryResultsForDate(env,date,true);
  return json({success:true,date,rounds:ROUNDS,serverNow:Date.now(),results});
}

async function buildBackup(env) {
  const res = await env.DB.prepare(`SELECT * FROM app_results ORDER BY result_date, ${roundOrderSql("ASC")} LIMIT ?`).bind(MAX_BACKUP_ROWS).all();
  return {backupVersion:1,appId:"tartay-2d",createdAt:new Date().toISOString(),results:res.results || []};
}

async function storeSafetyBackup(env) {
  await ensureSchema(env);
  const backup = await buildBackup(env);
  await env.DB.prepare(`INSERT INTO app_backups(backup_type,payload) VALUES('safety',?)`).bind(JSON.stringify(backup)).run();
  await env.DB.prepare(`DELETE FROM app_backups WHERE id NOT IN (SELECT id FROM app_backups ORDER BY id DESC LIMIT 10)`).run();
  return backup;
}

async function handleBackup(request, env) {
  if (!(await requireAdmin(request, env))) return json({success:false,error:"Unauthorized."},401);
  const backup = await buildBackup(env);
  await logAdmin(env,"backup_download",{rows:backup.results.length});
  return new Response(JSON.stringify(backup,null,2),{headers:{"Content-Type":"application/json; charset=UTF-8","Content-Disposition":`attachment; filename="tartay-2d-backup-${getOperationalDate()}.json"`,"Cache-Control":"no-store"}});
}

function validateBackup(backup) {
  if (!backup || backup.backupVersion !== 1 || backup.appId !== "tartay-2d" || !Array.isArray(backup.results)) throw new Error("Invalid Tartay 2D backup file.");
  if (backup.results.length > MAX_BACKUP_ROWS) throw new Error("Backup is too large.");
  for (const row of backup.results) {
    if (!parseDateUTC(row.result_date) || !ROUNDS.includes(row.round_time) || !clean2D(row.result_2d)) throw new Error("Backup contains invalid result data.");
  }
}

async function handleRestore(request, env) {
  if (!(await requireAdmin(request, env))) return json({success:false,error:"Unauthorized."},401);
  const body = await readJson(request);
  try { validateBackup(body?.backup); } catch(e) { return json({success:false,error:e.message},400); }
  const mode = body?.mode === "replace" ? "replace" : "merge";
  await storeSafetyBackup(env);
  if (mode === "replace") await env.DB.prepare(`DELETE FROM app_results`).run();
  for (const row of body.backup.results) {
    await env.DB.prepare(`INSERT INTO app_results(result_date,round_time,result_2d,set_value,value_value,publish_mode,auto_publish,published_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP),COALESCE(?,CURRENT_TIMESTAMP))
      ON CONFLICT(result_date,round_time) DO UPDATE SET result_2d=excluded.result_2d,set_value=excluded.set_value,value_value=excluded.value_value,publish_mode=excluded.publish_mode,auto_publish=excluded.auto_publish,published_at=excluded.published_at,updated_at=excluded.updated_at`)
      .bind(row.result_date,row.round_time,row.result_2d,row.set_value??null,row.value_value??null,normaliseMode(row.publish_mode),Number(row.auto_publish??1),row.published_at??null,row.created_at??null,row.updated_at??null).run();
  }
  await logAdmin(env,"restore",{mode,rows:body.backup.results.length});
  return json({success:true,mode,rows:body.backup.results.length});
}

async function handleLogs(request, env) {
  if (!(await requireAdmin(request, env))) return json({success:false,error:"Unauthorized."},401);
  await ensureSchema(env);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "error" ? "error" : "admin";
  const table = type === "error" ? "app_error_logs" : "app_admin_logs";
  const res = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 100`).all();
  return json({success:true,type,logs:res.results || []});
}

async function cronAutoPublish(env) {
  const date = getOperationalDate();
  const rows = await queryResultsForDate(env,date,true);
  for (const row of rows) {
    if (normaliseMode(row.publish_mode) === "schedule" && Number(row.auto_publish??1) === 1 && !row.published_at && isRoundReleased(row.result_date,row.round_time)) {
      await env.DB.prepare(`UPDATE app_results SET published_at=CURRENT_TIMESTAMP WHERE id=? AND published_at IS NULL`).bind(row.id).run();
    }
  }
}

export class RoundAlarm {
  constructor(state, env) { this.state=state; this.env=env; }
  async fetch() { return new Response("RoundAlarm is active",{status:200}); }
  async alarm() { await cronAutoPublish(this.env); }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/status") return json({app:"Tartay 2D",status:"Online",version:"6.7.0",database:"connected",operational_date:getOperationalDate(),serverNow:Date.now()});
      if (request.method === "GET" && (url.pathname === "/api/state" || url.pathname === "/api/results/state")) return handleState(env);
      if (request.method === "GET" && url.pathname === "/api/market") return json({success:true, market:await fetchLiveMarket(), serverNow:Date.now()});
      if (request.method === "GET" && url.pathname === "/api/results/today") return handleToday(url,env);
      if (request.method === "GET" && url.pathname === "/api/results/history") return handleHistory(url,env);
      if (request.method === "POST" && url.pathname === "/api/admin/login") return handleLogin(request,env);
      if (request.method === "POST" && url.pathname === "/api/admin/result") return handleSaveResult(request,env);
      if (request.method === "POST" && url.pathname === "/api/admin/unpublish") return handleUnpublish(request,env);
      if (request.method === "GET" && url.pathname === "/api/admin/state") return handleAdminState(request,env);
      if (request.method === "GET" && url.pathname === "/api/admin/backup") return handleBackup(request,env);
      if (request.method === "POST" && url.pathname === "/api/admin/restore") return handleRestore(request,env);
      if (request.method === "GET" && url.pathname === "/api/admin/logs") return handleLogs(request,env);
      if (url.pathname.startsWith("/api/")) return json({success:false,error:"API route not found."},404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Tartay Worker Error", error);
      await logError(env,error,{url:request.url,method:request.method});
      return json({success:false,error:"Internal server error."},500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(cronAutoPublish(env)); }
};
