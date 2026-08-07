import { DurableObject } from "cloudflare:workers";

const DATA_KEY = "six_times_2d_state_v5";

const TIMES = [
  "09:00 AM",
  "11:00 AM",
  "01:00 PM",
  "03:00 PM",
  "05:00 PM",
  "07:00 PM"
];

const RATE_LIMIT = 10;
const LIVE_REFRESH_MS = 10000;
const BLINK_INTERVAL_MS = 3500;
const PUBLISH_BURST_INTERVAL_MS = 400;
const PUBLISH_BURST_ATTEMPTS = 20;
const YANGON_UTC_OFFSET_MINUTES = 6 * 60 + 30;
const OVERRIDE_MS = 2 * 60 * 1000;

const BACKUP_VERSION = 1;
const BACKUP_APP_ID = "new-zealand-2d";
const MAX_JSON_BYTES = 2 * 1024 * 1024;

const HISTORY_PREFIX = "history:";
const DAILY_BACKUP_PREFIX = "backup:daily:";
const SAFETY_BACKUP_PREFIX = "backup:pre-restore:";
const ADMIN_LOG_PREFIX = "log:admin:";
const ERROR_LOG_PREFIX = "log:error:";
const REQUEST_PREFIX = "admin-request:";
const ROUND_LOCK_PREFIX = "round-lock:";

const ROUND_LOCK_TTL_SECONDS = 60;
const ROUND_LOCK_SETTLE_MS = 40;
const ADMIN_READ_RATE_LIMIT = 60;

const DAILY_BACKUP_KEEP_DAYS = 30;
const SAFETY_BACKUP_KEEP_COUNT = 10;
const LOG_KEEP_SECONDS = 30 * 24 * 60 * 60;
const REQUEST_KEEP_SECONDS = 5 * 60;

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security":
    "max-age=31536000; includeSubDomains"
};

const HTML_HEADERS = {
  ...SECURITY_HEADERS,
  "Content-Security-Policy":
    "default-src 'self'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'none'; " +
    "object-src 'none'; " +
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "connect-src 'self' https://challenges.cloudflare.com; " +
    "frame-src https://challenges.cloudflare.com;"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json;charset=UTF-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...extraHeaders
    }
  });
}

function htmlResponse(html, extraHeaders = {}) {
  return new Response(html, {
    headers: {
      ...HTML_HEADERS,
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...extraHeaders
    }
  });
}

function yangonParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const result = {};
  for (const part of parts) {
    result[part.type] = part.value;
  }
  return result;
}

function yangonDate(date = new Date()) {
  const parts = yangonParts(date);
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function yangonNowText(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  })
    .format(date)
    .replace(/\b(am|pm)\b/gi, function(period) {
      return period.toUpperCase();
    });
}

function timeToMinutes(time) {
  const match = String(time || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (hour === 12) {
    hour = 0;
  }
  if (period === "PM") {
    hour += 12;
  }

  return hour * 60 + minute;
}

function scheduleToEpochMs(scheduleDate, time) {
  if (!isRealDate(scheduleDate)) {
    return null;
  }

  const minutes = timeToMinutes(time);
  if (minutes === null) {
    return null;
  }

  const [year, month, day] = String(scheduleDate).split("-").map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return (
    Date.UTC(year, month - 1, day, hour, minute, 0, 0) -
    YANGON_UTC_OFFSET_MINUTES * 60 * 1000
  );
}

function isRealDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }

  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function shiftDateText(value, offsetDays) {
  if (!isRealDate(value)) {
    return "";
  }

  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));

  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function compareScheduleToNow(scheduleDate, time, now = new Date()) {
  if (!isRealDate(scheduleDate)) {
    return null;
  }

  const targetMinute = timeToMinutes(time);
  if (targetMinute === null) {
    return null;
  }

  const today = yangonDate(now);
  if (scheduleDate < today) {
    return -1;
  }
  if (scheduleDate > today) {
    return 1;
  }

  const parts = yangonParts(now);
  const currentMinute = Number(parts.hour) * 60 + Number(parts.minute);

  if (targetMinute < currentMinute) {
    return -1;
  }
  if (targetMinute > currentMinute) {
    return 1;
  }
  return 0;
}

function formatNumber(value) {
  const number = Number(
    String(value ?? "")
      .replace(/,/g, "")
      .trim()
  );

  return Number.isFinite(number)
    ? number.toFixed(2)
    : "0.00";
}

function strictMarketNumber(value, label, allowZero = false) {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .trim();

  if (!/^\d+\.\d{2}$/.test(text)) {
    throw new HttpError(
      400,
      label + " ကို ဒဿမ ၂ လုံးဖြင့်ထည့်ပါ။ ဥပမာ 1423.67"
    );
  }

  const number = Number(text);
  if (!Number.isFinite(number) || (!allowZero && number <= 0) || number < 0) {
    throw new HttpError(400, label + " မှန်ကန်သောဂဏန်း ထည့်ပါ");
  }

  return number.toFixed(2);
}

function cleanResult(value) {
  const result = String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 2);

  return /^\d{2}$/.test(result) ? result : "";
}

function requireResult(value, label = "2D Result") {
  const result = cleanResult(value);
  if (!result) {
    throw new HttpError(400, label + " ကို ဂဏန်း ၂ လုံးထည့်ပါ");
  }
  return result;
}

function calculate2D(setValue, valueValue) {
  const setDigits = String(setValue ?? "")
    .replace(/,/g, "")
    .replace(/\D/g, "");

  const valueDigits = String(valueValue ?? "")
    .replace(/,/g, "")
    .split(".")[0]
    .replace(/\D/g, "");

  if (!setDigits || !valueDigits) {
    return "--";
  }

  return setDigits.slice(-1) + valueDigits.slice(-1);
}

function createState() {
  const today = yangonDate();

  return {
    version: 6,
    date: today,
    live: {
      status: "active",
      baseSet: "1423.67",
      baseValue: "58324.91",
      frozen: null,
      override: null
    },
    rounds: TIMES.map((time, index) => ({
      round: index + 1,
      time,
      scheduleDate: today,
      set: "0.00",
      value: "0.00",
      result: "--",
      status: "waiting",
      autoPublish: false,
      publishedAt: "",
      publishedAtMs: 0
    }))
  };
}

function normaliseSnapshot(snapshot, requireUntil = false) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  const result = cleanResult(snapshot.result);
  const output = {
    set: formatNumber(snapshot.set),
    value: formatNumber(snapshot.value),
    result: result || "--",
    updatedAt: String(snapshot.updatedAt || "")
  };

  if (requireUntil) {
    output.until = Number(snapshot.until || 0);
  }

  return output;
}

function normaliseState(rawState) {
  const fresh = createState();
  const state =
    rawState && typeof rawState === "object" && !Array.isArray(rawState)
      ? rawState
      : fresh;

  const live =
    state.live && typeof state.live === "object" && !Array.isArray(state.live)
      ? state.live
      : fresh.live;

  const rounds =
    Array.isArray(state.rounds) && state.rounds.length === 6
      ? state.rounds
      : fresh.rounds;

  return {
    version: 6,
    date: isRealDate(state.date) ? state.date : fresh.date,
    live: {
      status: live.status === "paused" ? "paused" : "active",
      baseSet: formatNumber(live.baseSet || fresh.live.baseSet),
      baseValue: formatNumber(live.baseValue || fresh.live.baseValue),
      frozen: normaliseSnapshot(live.frozen, false),
      override: normaliseSnapshot(live.override, true)
    },
    rounds: rounds.slice(0, 6).map((round, index) => ({
      round: index + 1,
      time: timeToMinutes(round?.time) === null ? TIMES[index] : String(round.time),
      scheduleDate: isRealDate(round?.scheduleDate)
        ? String(round.scheduleDate)
        : fresh.date,
      set: formatNumber(round?.set),
      value: formatNumber(round?.value),
      result: cleanResult(round?.result) || "--",
      status: round?.status === "published" ? "published" : "waiting",
      autoPublish: Boolean(round?.autoPublish),
      publishedAt: String(round?.publishedAt || ""),
      publishedAtMs: Number(round?.publishedAtMs || 0)
    }))
  };
}

async function saveState(env, state) {
  await env.DATA.put(DATA_KEY, JSON.stringify(state));
}

async function getState(env) {
  if (!env.DATA) {
    throw new HttpError(500, "DATA KV Binding မရှိသေးပါ");
  }

  const stored = await env.DATA.get(DATA_KEY, { type: "json" });
  let state = normaliseState(stored || createState());
  const today = yangonDate();

  if (state.date !== today) {
    const baseSet = state.live.baseSet;
    const baseValue = state.live.baseValue;

    state = createState();
    state.live.baseSet = formatNumber(baseSet);
    state.live.baseValue = formatNumber(baseValue);

    await saveState(env, state);
    await writeSystemLog(env, "midnight_reset", {
      date: today
    });
  } else if (!stored) {
    await saveState(env, state);
  }

  return state;
}

async function getHistory(env, selectedDate) {
  const items = await env.DATA.get(HISTORY_PREFIX + selectedDate, {
    type: "json"
  });
  return Array.isArray(items) ? items : [];
}

async function putHistory(env, selectedDate, items) {
  const sorted = items
    .slice(0, 6)
    .sort((a, b) => Number(a.round) - Number(b.round));

  if (sorted.length === 0) {
    await env.DATA.delete(HISTORY_PREFIX + selectedDate);
    return;
  }

  await env.DATA.put(
    HISTORY_PREFIX + selectedDate,
    JSON.stringify(sorted)
  );
}

async function addHistory(env, item) {
  const items = await getHistory(env, item.date);
  const index = items.findIndex(
    oldItem => Number(oldItem.round) === Number(item.round)
  );

  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }

  await putHistory(env, item.date, items);
}

async function deleteHistoryRound(env, selectedDate, roundNumber) {
  const items = await getHistory(env, selectedDate);
  const next = items.filter(
    item => Number(item.round) !== Number(roundNumber)
  );
  await putHistory(env, selectedDate, next);
  return next;
}

async function listKvKeyNames(env, prefix) {
  const names = [];
  let cursor;

  do {
    const options = { prefix };
    if (cursor) {
      options.cursor = cursor;
    }

    const page = await env.DATA.list(options);
    for (const key of page.keys || []) {
      names.push(key.name);
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return names;
}

async function deleteKeysWithPrefix(env, prefix) {
  const names = await listKvKeyNames(env, prefix);
  for (const name of names) {
    await env.DATA.delete(name);
  }
  return names.length;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function reverseTimestamp() {
  return String(9999999999999 - Date.now()).padStart(13, "0");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireRoundLock(env, roundNumber) {
  const key = ROUND_LOCK_PREFIX + String(roundNumber);
  const token = randomId();

  if (await env.DATA.get(key)) {
    return null;
  }

  await env.DATA.put(key, token, {
    expirationTtl: ROUND_LOCK_TTL_SECONDS
  });

  return { key, token };
}

async function releaseRoundLock(env, lock) {
  if (!lock) {
    return;
  }

  // KV reads can briefly return stale data immediately after a write. Reading
  // the lock again before deleting could therefore leave it alive until TTL and
  // delay a scheduled result. Every round operation is short and owns this key,
  // so release it directly in finally. The short TTL remains a safety fallback.
  await env.DATA.delete(lock.key);
}

async function writeLog(env, prefix, entry, ttl = LOG_KEEP_SECONDS) {
  if (!env.DATA) {
    return;
  }

  const key = prefix + reverseTimestamp() + ":" + randomId();
  const value = {
    at: new Date().toISOString(),
    atYangon: yangonNowText(),
    ...entry
  };

  await env.DATA.put(key, JSON.stringify(value), {
    expirationTtl: ttl
  });
}

async function writeSystemLog(env, action, details = {}) {
  await writeLog(env, ADMIN_LOG_PREFIX, {
    source: "system",
    action,
    details
  });
}

async function adminActor(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await sha256(ip);
  return {
    ipHash: digest.slice(0, 12),
    userAgent: String(request.headers.get("User-Agent") || "").slice(0, 160)
  };
}

async function logAdminAction(env, request, action, details = {}) {
  await writeLog(env, ADMIN_LOG_PREFIX, {
    source: "admin",
    action,
    actor: await adminActor(request),
    details
  });
}

async function logServerError(env, error, request, context = {}) {
  try {
    await writeLog(env, ERROR_LOG_PREFIX, {
      message: String(error?.message || error || "Unknown error").slice(0, 500),
      stack: String(error?.stack || "").slice(0, 1500),
      method: request?.method || "",
      path: request ? new URL(request.url).pathname : "",
      context
    });
  } catch (logError) {
    console.error("Error logging failed", logError);
  }
}

async function listRecentLogs(env, prefix, limit = 50) {
  const page = await env.DATA.list({
    prefix,
    limit: Math.min(Math.max(Number(limit) || 50, 1), 100)
  });

  const logs = [];
  for (const key of page.keys || []) {
    const item = await env.DATA.get(key.name, { type: "json" });
    if (item) {
      logs.push(item);
    }
  }
  return logs;
}

function safeBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function jsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function backupToJsonText(backup) {
  const text = JSON.stringify(backup, null, 2);
  const size = new TextEncoder().encode(text).byteLength;

  if (size > MAX_JSON_BYTES) {
    throw new HttpError(413, "Backup File Size 2 MB ထက်ကျော်နေပါတယ်");
  }
  return text;
}

async function collectHistoryForBackup(env) {
  const names = await listKvKeyNames(env, HISTORY_PREFIX);
  const history = {};

  for (const name of names) {
    const date = name.slice(HISTORY_PREFIX.length);
    if (!isRealDate(date)) {
      continue;
    }

    const items = await env.DATA.get(name, { type: "json" });
    if (Array.isArray(items)) {
      history[date] = items;
    }
  }

  return history;
}

async function buildFullBackup(env) {
  return {
    backupVersion: BACKUP_VERSION,
    appId: BACKUP_APP_ID,
    appName: "Tartay 2D",
    dataKey: DATA_KEY,
    createdAt: new Date().toISOString(),
    createdAtYangon: yangonNowText(),
    state: await getState(env),
    history: await collectHistoryForBackup(env)
  };
}

function restoreValidationError(message) {
  throw new HttpError(400, "Restore File မမှန်ပါ: " + message);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isBackupNumber(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return (
    text !== "" &&
    Number.isFinite(Number(text)) &&
    Number(text) >= 0
  );
}

function validateLiveSnapshotForRestore(snapshot, label, requireUntil = false) {
  if (snapshot === null || snapshot === undefined) {
    return;
  }

  if (!isPlainObject(snapshot)) {
    restoreValidationError(label + " Data ပုံစံမှားနေပါတယ်");
  }

  if (!isBackupNumber(snapshot.set) || !isBackupNumber(snapshot.value)) {
    restoreValidationError(label + " SET / VALUE မှားနေပါတယ်");
  }

  if (!/^\d{2}$/.test(String(snapshot.result || ""))) {
    restoreValidationError(label + " 2D Result မှားနေပါတယ်");
  }

  if (typeof snapshot.updatedAt !== "string") {
    restoreValidationError(label + " Updated Time မှားနေပါတယ်");
  }

  if (
    requireUntil &&
    (!Number.isFinite(Number(snapshot.until)) || Number(snapshot.until) < 0)
  ) {
    restoreValidationError(label + " Expire Time မှားနေပါတယ်");
  }
}

function validateBackupStateForRestore(state) {
  if (!isPlainObject(state)) {
    restoreValidationError("State Data ပုံစံမှားနေပါတယ်");
  }
  if (!isRealDate(state.date)) {
    restoreValidationError("State Date မှားနေပါတယ်");
  }
  if (!isPlainObject(state.live)) {
    restoreValidationError("Live Data မရှိပါ");
  }
  if (state.live.status !== "active" && state.live.status !== "paused") {
    restoreValidationError("Live Status မှားနေပါတယ်");
  }
  if (
    !isBackupNumber(state.live.baseSet) ||
    !isBackupNumber(state.live.baseValue)
  ) {
    restoreValidationError("Base SET / VALUE မှားနေပါတယ်");
  }

  validateLiveSnapshotForRestore(state.live.frozen, "Frozen Live");
  validateLiveSnapshotForRestore(state.live.override, "Override Live", true);

  if (
    state.live.status === "paused" &&
    !isPlainObject(state.live.frozen)
  ) {
    restoreValidationError("Paused Live အတွက် Frozen Data မရှိပါ");
  }

  if (!Array.isArray(state.rounds) || state.rounds.length !== 6) {
    restoreValidationError("Round ၆ ခု မပြည့်ပါ");
  }

  state.rounds.forEach((round, index) => {
    const label = "Round " + (index + 1);

    if (!isPlainObject(round)) {
      restoreValidationError(label + " Data ပုံစံမှားနေပါတယ်");
    }
    if (Number(round.round) !== index + 1) {
      restoreValidationError(label + " Number မှားနေပါတယ်");
    }
    if (timeToMinutes(round.time) === null) {
      restoreValidationError(label + " Time မှားနေပါတယ်");
    }
    if (!isRealDate(round.scheduleDate)) {
      restoreValidationError(label + " Date မှားနေပါတယ်");
    }
    if (!isBackupNumber(round.set) || !isBackupNumber(round.value)) {
      restoreValidationError(label + " SET / VALUE မှားနေပါတယ်");
    }

    const result = String(round.result || "");
    if (result !== "--" && !/^\d{2}$/.test(result)) {
      restoreValidationError(label + " 2D Result မှားနေပါတယ်");
    }
    if (round.status !== "waiting" && round.status !== "published") {
      restoreValidationError(label + " Status မှားနေပါတယ်");
    }
    if (typeof round.autoPublish !== "boolean") {
      restoreValidationError(label + " Auto Publish မှားနေပါတယ်");
    }
    if (typeof round.publishedAt !== "string") {
      restoreValidationError(label + " Published Time မှားနေပါတယ်");
    }
    if (
      !Number.isFinite(Number(round.publishedAtMs)) ||
      Number(round.publishedAtMs) < 0
    ) {
      restoreValidationError(label + " Published Timestamp မှားနေပါတယ်");
    }

    if (round.status === "published") {
      if (!/^\d{2}$/.test(result)) {
        restoreValidationError(label + " Published Result မရှိပါ");
      }
      if (Number(round.set) <= 0 || Number(round.value) <= 0) {
        restoreValidationError(label + " Published SET / VALUE မရှိပါ");
      }
      if (!String(round.publishedAt).trim()) {
        restoreValidationError(label + " Published Time မရှိပါ");
      }
      if (Number(round.publishedAtMs) <= 0) {
        restoreValidationError(label + " Published Timestamp မရှိပါ");
      }
    }
  });

  return state;
}

function validateBackupHistoryForRestore(history) {
  if (!isPlainObject(history)) {
    restoreValidationError("History Data ပုံစံမှားနေပါတယ်");
  }

  for (const [historyDate, items] of Object.entries(history)) {
    if (!isRealDate(historyDate)) {
      restoreValidationError("History Date မှားနေပါတယ်: " + historyDate);
    }
    if (!Array.isArray(items)) {
      restoreValidationError(
        historyDate + " History Records ပုံစံမှားနေပါတယ်"
      );
    }
    if (items.length > 6) {
      restoreValidationError(
        historyDate + " History Round ၆ ခုထက်ကျော်နေပါတယ်"
      );
    }

    const usedRounds = new Set();

    items.forEach((item, index) => {
      const label =
        historyDate + " History Record " + (index + 1);

      if (!isPlainObject(item)) {
        restoreValidationError(label + " Data ပုံစံမှားနေပါတယ်");
      }
      if (String(item.date || "") !== historyDate) {
        restoreValidationError(label + " Date မကိုက်ပါ");
      }

      const roundNumber = Number(item.round);
      if (
        !Number.isInteger(roundNumber) ||
        roundNumber < 1 ||
        roundNumber > 6
      ) {
        restoreValidationError(label + " Round Number မှားနေပါတယ်");
      }
      if (usedRounds.has(roundNumber)) {
        restoreValidationError(
          historyDate + " Round " + roundNumber + " ထပ်နေပါတယ်"
        );
      }
      usedRounds.add(roundNumber);

      if (timeToMinutes(item.time) === null) {
        restoreValidationError(label + " Time မှားနေပါတယ်");
      }
      if (!/^\d{2}$/.test(String(item.result || ""))) {
        restoreValidationError(label + " 2D Result မှားနေပါတယ်");
      }

      const setText = String(item.set ?? "").trim();
      const valueText = String(item.value ?? "").trim();
      const bothEmpty = setText === "" && valueText === "";
      const bothLegacyZero =
        isBackupNumber(setText) &&
        isBackupNumber(valueText) &&
        Number(setText.replace(/,/g, "")) === 0 &&
        Number(valueText.replace(/,/g, "")) === 0;
      const bothValid =
        isBackupNumber(setText) &&
        isBackupNumber(valueText) &&
        Number(setText.replace(/,/g, "")) > 0 &&
        Number(valueText.replace(/,/g, "")) > 0;

      if (!bothEmpty && !bothLegacyZero && !bothValid) {
        restoreValidationError(label + " SET / VALUE မှားနေပါတယ်");
      }

      if (
        typeof item.publishedAt !== "string" ||
        !item.publishedAt.trim()
      ) {
        restoreValidationError(label + " Published Time မရှိပါ");
      }

      if (
        !Number.isFinite(Number(item.publishedAtMs)) ||
        Number(item.publishedAtMs) < 0
      ) {
        restoreValidationError(label + " Published Timestamp မှားနေပါတယ်");
      }
    });
  }

  return history;
}

function validateBackupEnvelopeForRestore(backup) {
  if (!isPlainObject(backup)) {
    restoreValidationError("JSON Object ပုံစံ မဟုတ်ပါ");
  }
  if (jsonByteLength(backup) > MAX_JSON_BYTES) {
    throw new HttpError(413, "Restore File Size 2 MB ထက်ကျော်နေပါတယ်");
  }
  if (backup.backupVersion !== BACKUP_VERSION) {
    restoreValidationError("Backup Version မကိုက်ပါ");
  }
  if (String(backup.appId || "") !== BACKUP_APP_ID) {
    restoreValidationError("ဒီ App အတွက် Backup File မဟုတ်ပါ");
  }
  if (String(backup.dataKey || "") !== DATA_KEY) {
    restoreValidationError("Backup Data Key မကိုက်ပါ");
  }
  if (
    !backup.createdAt ||
    Number.isNaN(Date.parse(String(backup.createdAt)))
  ) {
    restoreValidationError("Backup Created Time မှားနေပါတယ်");
  }

  validateBackupStateForRestore(backup.state);
  validateBackupHistoryForRestore(backup.history);
  return backup;
}

async function cleanupSafetyBackups(env) {
  const names = await listKvKeyNames(env, SAFETY_BACKUP_PREFIX);
  const sorted = names.sort();

  for (const name of sorted.slice(SAFETY_BACKUP_KEEP_COUNT)) {
    await env.DATA.delete(name);
  }
}

async function createSafetyBackup(env) {
  const backup = await buildFullBackup(env);
  const key =
    SAFETY_BACKUP_PREFIX + reverseTimestamp() + ":" + randomId();

  await env.DATA.put(key, backupToJsonText(backup), {
    expirationTtl: 90 * 24 * 60 * 60
  });

  await cleanupSafetyBackups(env);
  return key;
}

async function cleanupDailyBackups(env) {
  const names = await listKvKeyNames(env, DAILY_BACKUP_PREFIX);
  const cutoff = Date.now() - DAILY_BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;

  for (const name of names) {
    const dateText = name.slice(DAILY_BACKUP_PREFIX.length, DAILY_BACKUP_PREFIX.length + 10);
    if (!isRealDate(dateText)) {
      await env.DATA.delete(name);
      continue;
    }

    const created = Date.parse(dateText + "T00:00:00Z");
    if (created < cutoff) {
      await env.DATA.delete(name);
    }
  }
}

async function createDailyBackup(env) {
  const date = yangonDate();
  const key = DAILY_BACKUP_PREFIX + date;
  const exists = await env.DATA.get(key);

  // Cron may run many times per day. When today's backup already exists,
  // return immediately so KV.list() is not called on every scheduled run.
  if (exists) {
    return false;
  }

  const backup = await buildFullBackup(env);
  await env.DATA.put(key, backupToJsonText(backup), {
    expirationTtl: (DAILY_BACKUP_KEEP_DAYS + 5) * 24 * 60 * 60
  });

  // Listing old backup keys is needed only when a new daily backup is made.
  await cleanupDailyBackups(env);
  await writeSystemLog(env, "daily_backup_created", { date });
  return true;
}

async function writeBackupHistory(env, history, mode) {
  if (mode === "history_replace" || mode === "full_replace") {
    await deleteKeysWithPrefix(env, HISTORY_PREFIX);
  }

  for (const [date, backupItems] of Object.entries(history)) {
    if (mode === "history_merge") {
      const current = await getHistory(env, date);
      const merged = [...current];

      for (const item of backupItems) {
        const index = merged.findIndex(
          oldItem => Number(oldItem.round) === Number(item.round)
        );
        if (index >= 0) {
          merged[index] = item;
        } else {
          merged.push(item);
        }
      }

      await putHistory(env, date, merged);
    } else {
      await putHistory(env, date, backupItems);
    }
  }
}

async function restoreBackup(env, backup, mode) {
  validateBackupEnvelopeForRestore(backup);

  if (!["full_replace", "history_replace", "history_merge"].includes(mode)) {
    throw new HttpError(400, "Restore Mode မှားနေပါတယ်");
  }

  await createSafetyBackup(env);

  if (mode === "full_replace") {
    await saveState(env, normaliseState(backup.state));
  }

  await writeBackupHistory(env, backup.history, mode);

  return {
    mode,
    restoredHistoryDates: Object.keys(backup.history).length,
    stateRestored: mode === "full_replace"
  };
}

function getLiveData(live) {
  const now = Date.now();

  if (
    live.override &&
    now < Number(live.override.until || 0)
  ) {
    return {
      set: live.override.set,
      value: live.override.value,
      result: live.override.result,
      updatedAt: live.override.updatedAt,
      status: "published",
      resumeAtMs: Number(live.override.until || 0)
    };
  }

  if (live.status === "paused" && live.frozen) {
    return {
      set: live.frozen.set,
      value: live.frozen.value,
      result: live.frozen.result,
      updatedAt: live.frozen.updatedAt,
      status: "paused",
      resumeAtMs: 0
    };
  }

  const tick = Math.floor(now / LIVE_REFRESH_MS);
  const set = formatNumber(
    Number(live.baseSet || 0) + ((tick % 21) - 10) * 0.03
  );
  const value = formatNumber(
    Number(live.baseValue || 0) + (((tick * 7) % 101) - 50) * 3.17
  );

  return {
    set,
    value,
    result: calculate2D(set, value),
    status: "active",
    updatedAt: yangonNowText(),
    resumeAtMs: 0
  };
}

function getPublicStatus(state, live) {
  if (live.status === "published") {
    return {
      code: "published",
      label: "PUBLISHED",
      detail: ""
    };
  }

  if (live.status === "paused") {
    return {
      code: "paused",
      label: "PAUSED",
      detail: ""
    };
  }

  return {
    code: "active",
    label: "LIVE",
    detail: ""
  };
}

function publicRound(round) {
  const published =
    round?.status === "published" && /^\d{2}$/.test(String(round?.result || ""));

  return {
    round: Number(round?.round || 0),
    time: String(round?.time || ""),
    status: published ? "published" : "waiting",
    result: published ? String(round.result) : "--",
    publishedAt: published ? String(round.publishedAt || "") : "",
    publishedAtMs: published ? Number(round.publishedAtMs || 0) : 0
  };
}

function isAutoPublishDue(round, today = yangonDate()) {
  return Boolean(
    round &&
      round.autoPublish &&
      round.status !== "published" &&
      round.scheduleDate === today &&
      compareScheduleToNow(round.scheduleDate, round.time) !== 1 &&
      Number(round.set) > 0 &&
      Number(round.value) > 0
  );
}

async function publishRoundByNumber(
  env,
  roundNumber,
  expectedDate = "",
  expectedTime = "",
  source = "auto_publish"
) {
  const index = Number(roundNumber) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= TIMES.length) {
    return { published: false, reason: "invalid_round" };
  }

  const lock = await acquireRoundLock(env, roundNumber);
  if (!lock) {
    return { published: false, reason: "locked" };
  }

  try {
    const today = yangonDate();
    const state = await getState(env);
    const round = state.rounds[index];

    if (
      (expectedDate && round.scheduleDate !== expectedDate) ||
      (expectedTime && round.time !== expectedTime)
    ) {
      return { published: false, reason: "stale_alarm" };
    }

    if (round.status === "published") {
      return { published: false, reason: "already_published" };
    }

    if (!isAutoPublishDue(round, today)) {
      return { published: false, reason: "not_due" };
    }

    const publishedAtMs = Date.now();
    const publishedAt = yangonNowText();
    const publishedRound = {
      ...round,
      set: formatNumber(round.set),
      value: formatNumber(round.value),
      result: calculate2D(round.set, round.value),
      status: "published",
      publishedAt,
      publishedAtMs
    };

    state.rounds[index] = publishedRound;
    state.live.override = {
      set: publishedRound.set,
      value: publishedRound.value,
      result: publishedRound.result,
      updatedAt: publishedAt,
      until: publishedAtMs + OVERRIDE_MS
    };

    await addHistory(env, {
      date: publishedRound.scheduleDate,
      round: publishedRound.round,
      time: publishedRound.time,
      set: publishedRound.set,
      value: publishedRound.value,
      result: publishedRound.result,
      publishedAt,
      publishedAtMs
    });

    await saveState(env, state);
    await writeSystemLog(env, source, {
      date: publishedRound.scheduleDate,
      round: publishedRound.round,
      time: publishedRound.time,
      result: publishedRound.result,
      scheduledAtMs: scheduleToEpochMs(
        publishedRound.scheduleDate,
        publishedRound.time
      ),
      publishedAtMs
    });

    return {
      published: true,
      round: publishedRound.round,
      result: publishedRound.result,
      publishedAtMs
    };
  } finally {
    await releaseRoundLock(env, lock);
  }
}

async function autoPublish(env, source = "cron_fallback_publish") {
  const today = yangonDate();
  const snapshot = await getState(env);

  for (let index = 0; index < TIMES.length; index++) {
    if (!isAutoPublishDue(snapshot.rounds[index], today)) {
      continue;
    }

    await publishRoundByNumber(
      env,
      index + 1,
      snapshot.rounds[index].scheduleDate,
      snapshot.rounds[index].time,
      source
    );
  }

  return getState(env);
}

function getRoundAlarmStub(env, roundNumber) {
  if (!env.ROUND_ALARMS) {
    throw new HttpError(500, "ROUND_ALARMS Durable Object Binding မရှိသေးပါ");
  }

  const id = env.ROUND_ALARMS.idFromName("new-zealand-2d-round-" + roundNumber);
  return env.ROUND_ALARMS.get(id);
}

async function syncRoundAlarm(env, round) {
  const stub = getRoundAlarmStub(env, round.round);
  const response = await stub.fetch("https://round-alarm.internal/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      round: round.round,
      scheduleDate: round.scheduleDate,
      time: round.time,
      autoPublish: Boolean(round.autoPublish),
      status: round.status
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new HttpError(
      500,
      "Exact-time Alarm သိမ်းမရပါ: " + (message || response.status)
    );
  }
}

async function cancelRoundAlarm(env, roundNumber) {
  const stub = getRoundAlarmStub(env, roundNumber);
  const response = await stub.fetch("https://round-alarm.internal/cancel", {
    method: "POST"
  });

  if (!response.ok) {
    throw new HttpError(500, "Exact-time Alarm ပယ်ဖျက်မရပါ");
  }
}

async function syncAllRoundAlarms(env, state = null) {
  const currentState = state || (await getState(env));

  for (const round of currentState.rounds) {
    try {
      await syncRoundAlarm(env, round);
    } catch (error) {
      await logServerError(env, error, null, {
        source: "alarm_sync",
        round: round.round
      });
    }
  }
}

function getNextAutoPublishAtMs(state) {
  const now = Date.now();
  const times = state.rounds
    .filter(
      round =>
        round.autoPublish &&
        round.status !== "published" &&
        Number(round.set) > 0 &&
        Number(round.value) > 0
    )
    .map(round => scheduleToEpochMs(round.scheduleDate, round.time))
    .filter(value => Number.isFinite(value) && value >= now - 2 * 60 * 1000)
    .sort((a, b) => a - b);

  return times.length ? times[0] : 0;
}

function seededShuffle(values, seedText) {
  const output = values.slice();
  let seed = 2166136261;

  for (const character of String(seedText || "")) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619) >>> 0;
  }

  for (let index = output.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }

  return output;
}

function buildNearbyPreSpinPool(finalResult, seedText = "") {
  const target = cleanResult(finalResult);
  if (!target) {
    return [];
  }

  const firstDigit = target.charAt(0);
  const secondDigit = target.charAt(1);
  const preferred = [];
  const secondary = [];

  for (let number = 0; number <= 99; number++) {
    const candidate = String(number).padStart(2, "0");
    if (candidate === target) {
      continue;
    }

    const matchesFirst = candidate.includes(firstDigit);
    const matchesSecond = candidate.includes(secondDigit);

    if (!matchesFirst && !matchesSecond) {
      continue;
    }

    // Before the final publish time, only show numbers that feel related to the
    // final result by sharing one or both digits. Example: final 89 can spin
    // values like 82, 97, 88, 68 or 08; final 69 can spin 60, 56, 36 or 62.
    if (matchesFirst) {
      preferred.push(candidate);
    } else {
      secondary.push(candidate);
    }
  }

  return seededShuffle(preferred, seedText + ":nearby:preferred").concat(
    seededShuffle(secondary, seedText + ":nearby:secondary")
  );
}

function forceSetResultDigit(value, digit) {
  const formatted = formatNumber(value);
  const parts = formatted.split(".");
  const integerPart = parts[0] || "0";
  const decimalPart = String(parts[1] || "00").padEnd(2, "0");
  return integerPart + "." + decimalPart.charAt(0) + String(digit || "0").charAt(0);
}

function forceValueResultDigit(value, digit) {
  const formatted = formatNumber(value);
  const parts = formatted.split(".");
  const integerPart = String(parts[0] || "0");
  const decimalPart = String(parts[1] || "00").padEnd(2, "0").slice(0, 2);
  const nextInteger =
    integerPart.length > 1
      ? integerPart.slice(0, -1) + String(digit || "0").charAt(0)
      : String(digit || "0").charAt(0);
  return nextInteger + "." + decimalPart;
}

function buildPreSpinFrames(round, finalResult, seedText = "") {
  const pool = buildNearbyPreSpinPool(finalResult, seedText);
  if (!pool.length) {
    return [];
  }

  return pool.slice(0, 40).map((candidate, index) => {
    const setOffset = ((index % 9) - 4) * 0.07;
    const valueOffset = (((index * 7) % 17) - 8) * 3.0;
    const set = forceSetResultDigit(Number(round.set) + setOffset, candidate.charAt(0));
    const value = forceValueResultDigit(Number(round.value) + valueOffset, candidate.charAt(1));

    return {
      result: candidate,
      set,
      value
    };
  });
}

function getPreSpinFrames(state, targetMs) {
  const target = Number(targetMs) || 0;
  if (!target || target <= Date.now()) {
    return [];
  }

  const round = state.rounds.find(item => {
    if (
      !item.autoPublish ||
      item.status === "published" ||
      Number(item.set) <= 0 ||
      Number(item.value) <= 0
    ) {
      return false;
    }

    return scheduleToEpochMs(item.scheduleDate, item.time) === target;
  });

  if (!round) {
    return [];
  }

  const finalResult = calculate2D(round.set, round.value);
  return buildPreSpinFrames(
    round,
    finalResult,
    [round.scheduleDate, round.round, round.time, finalResult].join("|")
  );
}

function getPreSpinPool(state, targetMs) {
  const target = Number(targetMs) || 0;
  if (!target || target <= Date.now()) {
    return [];
  }

  const round = state.rounds.find(item => {
    if (
      !item.autoPublish ||
      item.status === "published" ||
      Number(item.set) <= 0 ||
      Number(item.value) <= 0
    ) {
      return false;
    }

    return scheduleToEpochMs(item.scheduleDate, item.time) === target;
  });

  if (!round) {
    return [];
  }

  const finalResult = calculate2D(round.set, round.value);
  return buildNearbyPreSpinPool(
    finalResult,
    [round.scheduleDate, round.round, round.time, finalResult].join("|")
  );
}

export class RoundAlarm extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/cancel") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.delete("job");
      return new Response("cancelled");
    }

    if (request.method === "POST" && url.pathname === "/schedule") {
      const job = await request.json();
      const roundNumber = Number(job.round);
      const targetMs = scheduleToEpochMs(job.scheduleDate, job.time);
      const shouldSchedule =
        Number.isInteger(roundNumber) &&
        roundNumber >= 1 &&
        roundNumber <= 6 &&
        Boolean(job.autoPublish) &&
        job.status !== "published" &&
        Number.isFinite(targetMs);

      if (!shouldSchedule) {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.delete("job");
        return new Response("cancelled");
      }

      const storedJob = {
        round: roundNumber,
        scheduleDate: String(job.scheduleDate),
        time: String(job.time),
        targetMs
      };

      await this.ctx.storage.put("job", storedJob);
      await this.ctx.storage.setAlarm(Math.max(targetMs, Date.now() + 50));

      return new Response(
        JSON.stringify({ success: true, targetMs }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    const job = await this.ctx.storage.get("job");
    if (!job) {
      return;
    }

    if (Date.now() + 25 < Number(job.targetMs)) {
      await this.ctx.storage.setAlarm(Number(job.targetMs));
      return;
    }

    const result = await publishRoundByNumber(
      this.env,
      Number(job.round),
      String(job.scheduleDate),
      String(job.time),
      "durable_alarm_publish"
    );

    if (result.reason === "locked") {
      throw new Error("Round is temporarily locked");
    }

    await this.ctx.storage.delete("job");
  }
}

async function checkRateLimit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hash = await sha256(ip);
  const bucket = Math.floor(Date.now() / 60000);
  const key = "admin-rate:" + hash + ":" + bucket;
  const count = Number((await env.DATA.get(key)) || 0);

  if (count >= RATE_LIMIT) {
    return false;
  }

  await env.DATA.put(key, String(count + 1), {
    expirationTtl: 120
  });
  return true;
}

async function checkAdminReadRateLimit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hash = await sha256(ip);
  const bucket = Math.floor(Date.now() / 60000);
  const key = "admin-read-rate:" + hash + ":" + bucket;
  const count = Number((await env.DATA.get(key)) || 0);

  if (count >= ADMIN_READ_RATE_LIMIT) {
    return false;
  }

  await env.DATA.put(key, String(count + 1), {
    expirationTtl: 120
  });
  return true;
}

async function timingSafeTextEqual(first, second) {
  const firstHash = await sha256(first);
  const secondHash = await sha256(second);

  let difference = firstHash.length ^ secondHash.length;
  const length = Math.max(firstHash.length, secondHash.length);

  for (let index = 0; index < length; index++) {
    difference |=
      (firstHash.charCodeAt(index) || 0) ^
      (secondHash.charCodeAt(index) || 0);
  }

  return difference === 0;
}

async function checkAdminPassword(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return {
      success: false,
      message: "ADMIN_PASSWORD Secret မရှိသေးပါ"
    };
  }

  const password = request.headers.get("X-Admin-Password") || "";
  const valid = password
    ? await timingSafeTextEqual(password, env.ADMIN_PASSWORD)
    : false;

  return valid
    ? { success: true }
    : { success: false, message: "Admin password မှားနေပါတယ်" };
}

async function protectAdminRead(request, env) {
  if (!(await checkAdminReadRateLimit(request, env))) {
    return jsonResponse(
      {
        success: false,
        message: "Admin Data ဖွင့်သည့်အကြိမ်များလွန်းပါတယ်။ ခဏစောင့်ပါ။"
      },
      429,
      { "Retry-After": "60" }
    );
  }

  const passwordCheck = await checkAdminPassword(request, env);
  return passwordCheck.success ? null : jsonResponse(passwordCheck, 401);
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) {
    return {
      success: false,
      message: "TURNSTILE_SECRET မရှိသေးပါ"
    };
  }
  if (!token) {
    return {
      success: false,
      message: "Human verification failed"
    };
  }

  const formData = new FormData();
  formData.append("secret", env.TURNSTILE_SECRET);
  formData.append("response", String(token));

  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) {
    formData.append("remoteip", ip);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: formData }
  );

  if (!response.ok) {
    return {
      success: false,
      message: "Human verification failed"
    };
  }

  const result = await response.json();

  if (
    result.success !== true ||
    (result.action && result.action !== "admin_action")
  ) {
    return {
      success: false,
      message: "Human verification failed"
    };
  }

  return { success: true };
}

async function consumeRequestId(request, env) {
  const requestId = String(
    request.headers.get("X-Request-ID") || ""
  ).trim();

  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(requestId)) {
    return {
      success: false,
      status: 400,
      message: "Request ID မမှန်ပါ"
    };
  }

  const key = REQUEST_PREFIX + (await sha256(requestId));
  const exists = await env.DATA.get(key);

  if (exists) {
    return {
      success: false,
      status: 409,
      message: "ဒီ Request ကို လုပ်ပြီးသားပါ"
    };
  }

  await env.DATA.put(key, "1", {
    expirationTtl: REQUEST_KEEP_SECONDS
  });

  return { success: true };
}

async function protectAdmin(request, env, body, options = {}) {
  if (!(await checkRateLimit(request, env))) {
    return jsonResponse(
      {
        success: false,
        message: "တစ်မိနစ်အတွင်း အကြိမ်များလွန်းပါတယ်။ ခဏစောင့်ပါ။"
      },
      429,
      { "Retry-After": "60" }
    );
  }

  const passwordCheck = await checkAdminPassword(request, env);
  if (!passwordCheck.success) {
    return jsonResponse(passwordCheck, 401);
  }

  const turnstileCheck = await verifyTurnstile(
    request,
    env,
    body.turnstileToken
  );
  if (!turnstileCheck.success) {
    return jsonResponse(turnstileCheck, 403);
  }

  if (options.dedupe !== false) {
    const requestCheck = await consumeRequestId(request, env);
    if (!requestCheck.success) {
      return jsonResponse(
        {
          success: false,
          message: requestCheck.message
        },
        requestCheck.status
      );
    }
  }

  return null;
}

async function readJsonBody(request, maxBytes = MAX_JSON_BYTES + 100000) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) {
    throw new HttpError(413, "Request File Size ကြီးလွန်းပါတယ်");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, "Request File Size ကြီးလွန်းပါတယ်");
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "JSON Data မှားနေပါတယ်");
  }
}

function appPage() {
  const page = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#02030b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="icon" href="/favicon.ico">
<title>Tartay 2D</title>
<style>
:root{
  --page:#02030b;
  --panel:#050817;
  --blue:#18b8ff;
  --violet:#8d67ff;
  --pink:#ff51df;
  --green:#38ff72;
  --white:#f7fbff;
  --muted:#aab5cf;
}
*{box-sizing:border-box}
html{background:var(--page)}
html,body,body *{
  -webkit-user-select:none !important;
  -moz-user-select:none !important;
  -ms-user-select:none !important;
  user-select:none !important;
  -webkit-touch-callout:none !important;
  -webkit-tap-highlight-color:transparent;
}
body{
  margin:0;
  min-height:100vh;
  overflow-x:hidden;
  color:var(--white);
  background:
    radial-gradient(circle at 17% 7%,rgba(0,157,255,.12),transparent 22%),
    radial-gradient(circle at 85% 18%,rgba(211,45,255,.10),transparent 25%),
    radial-gradient(circle at 50% 55%,rgba(67,26,168,.10),transparent 38%),
    linear-gradient(180deg,#01020a 0%,#030411 48%,#01020a 100%);
  font-family:Arial,"Helvetica Neue",sans-serif;
}
body.screen-fitted{overflow-y:hidden}
body::before{
  content:"";
  position:fixed;
  inset:0;
  z-index:-2;
  pointer-events:none;
  opacity:.72;
  background-image:
    radial-gradient(circle,#9fdcff 0 1px,transparent 1.5px),
    radial-gradient(circle,#f2a7ff 0 1px,transparent 1.5px),
    radial-gradient(circle,#fff 0 .8px,transparent 1.2px);
  background-size:137px 137px,193px 193px,83px 83px;
  background-position:11px 17px,59px 91px,29px 43px;
}
button,a{font:inherit}
.app-viewport{width:100%;overflow:hidden;display:flex;justify-content:center;align-items:flex-start}
.app-shell{width:min(100%,820px);min-height:100vh;flex:0 0 auto;margin:0;padding-bottom:calc(24px + env(safe-area-inset-bottom));transform-origin:top center;will-change:transform}
.top{
  position:relative;
  z-index:50;
  display:grid;
  grid-template-columns:54px 1fr auto;
  align-items:center;
  gap:10px;
  min-height:104px;
  padding:max(14px,env(safe-area-inset-top)) 20px 10px;
  background:linear-gradient(180deg,rgba(1,2,10,.98),rgba(1,2,10,.76),transparent);
}
.menu-button{
  width:50px;
  height:50px;
  display:grid;
  place-content:center;
  gap:6px;
  padding:0;
  border:0;
  border-radius:14px;
  color:#dff4ff;
  background:transparent;
  cursor:pointer;
}
.menu-button span{
  display:block;
  width:35px;
  height:4px;
  border-radius:999px;
  background:linear-gradient(90deg,#dff4ff,#9fc9ee);
  box-shadow:0 0 9px rgba(98,199,255,.35);
}
.brand{
  min-width:0;
  text-align:center;
  white-space:nowrap;
  font-size:clamp(25px,6vw,39px);
  line-height:1;
  font-weight:900;
  letter-spacing:-1.2px;
  color:transparent;
  background:linear-gradient(90deg,
    #12b8ff 0%,
    #d946ef 18%,
    #45e6e6 36%,
    #ffad2f 54%,
    #55ff35 72%,
    #ff4fd8 88%,
    #12b8ff 100%
  );
  background-size:260% 100%;
  background-position:0% 50%;
  -webkit-background-clip:text;
  background-clip:text;
  filter:drop-shadow(0 0 8px rgba(103,149,255,.48));
  animation:brandColourFlow 5s ease-in-out infinite alternate;
  will-change:background-position;
}
@keyframes brandColourFlow{
  from{background-position:0% 50%}
  to{background-position:100% 50%}
}
.brand strong{font-weight:900}
.status{
  display:flex;
  align-items:center;
  gap:7px;
  min-width:102px;
  justify-content:center;
  padding:11px 13px;
  border:1.5px solid #29ff67;
  border-radius:999px;
  color:#effff3;
  background:rgba(1,30,15,.52);
  box-shadow:inset 0 0 18px rgba(33,255,99,.08),0 0 12px rgba(33,255,99,.13);
  font-size:14px;
  font-weight:900;
  letter-spacing:.4px;
}
.status-wave{font-size:17px;line-height:1;color:#2cff71;text-shadow:0 0 8px #23ff67}
.status-dot{width:9px;height:9px;border-radius:50%;background:#21ff60;box-shadow:0 0 11px #21ff60;animation:livePulse 1.45s ease-in-out infinite}
.status.paused{border-color:#ffab3e;color:#fff4e7;background:rgba(52,25,0,.55)}
.status.paused .status-wave,.status.paused .status-dot{color:#ffab3e;background:#ffab3e;text-shadow:none;box-shadow:0 0 11px #ffab3e}
.status.published{border-color:#d26cff;color:#fff1ff;background:rgba(38,5,52,.55)}
.status.published .status-wave,.status.published .status-dot{color:#ef69ff;background:#ef69ff;text-shadow:none;box-shadow:0 0 11px #ef69ff}
.status.offline{border-color:#ff4d63;color:#fff1f3;background:rgba(55,4,12,.62)}
.status.offline .status-wave,.status.offline .status-dot{color:#ff4d63;background:#ff4d63;text-shadow:none;box-shadow:0 0 11px #ff4d63;animation:none}
@keyframes livePulse{0%,100%{transform:scale(.86);opacity:.68}50%{transform:scale(1.18);opacity:1}}
.wrap{padding:5px 16px 22px}
.hero-card{
  position:relative;
  isolation:isolate;
  overflow:hidden;
  padding:28px 18px 20px;
  border:1px solid rgba(199,217,255,.90);
  border-radius:37px;
  background:
    radial-gradient(circle at 50% 35%,rgba(28,27,105,.32),transparent 37%),
    linear-gradient(160deg,rgba(4,7,22,.98),rgba(1,3,13,.98));
  box-shadow:
    inset 0 0 0 5px rgba(15,35,91,.38),
    inset 0 0 42px rgba(42,54,179,.09),
    0 0 9px rgba(113,164,255,.65),
    0 0 26px rgba(125,73,255,.25);
}
.hero-card::before{
  content:"";
  position:absolute;
  inset:10px;
  z-index:-1;
  border:1px solid rgba(77,81,255,.27);
  border-radius:29px;
  pointer-events:none;
}
.hero-card::after{
  content:"";
  position:absolute;
  inset:0;
  z-index:-2;
  pointer-events:none;
  background:
    linear-gradient(132deg,transparent 0 48%,rgba(109,70,255,.05) 49% 64%,transparent 65%),
    radial-gradient(circle at 13% 17%,#d6f1ff 0 1px,transparent 1.6px),
    radial-gradient(circle at 82% 14%,#f3cbff 0 1px,transparent 1.5px),
    radial-gradient(circle at 72% 45%,#8fc8ff 0 .9px,transparent 1.4px);
}
.update-label{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:10px;
  color:#cfd6eb;
  font-size:14px;
  font-weight:800;
  letter-spacing:3px;
}
.clock-icon{
  position:relative;
  display:inline-block;
  width:21px;
  height:21px;
  flex:0 0 21px;
  border:2px solid currentColor;
  border-radius:50%;
  color:#a18cff;
  box-shadow:0 0 9px currentColor;
}
.clock-icon::before,.clock-icon::after{content:"";position:absolute;left:50%;top:50%;width:2px;border-radius:3px;background:currentColor;transform-origin:50% 100%}
.clock-icon::before{height:6px;transform:translate(-50%,-100%)}
.clock-icon::after{height:5px;transform:translate(-50%,-100%) rotate(122deg)}
.updated{
  min-height:27px;
  margin-top:10px;
  text-align:center;
  color:#f4f6ff;
  font-size:clamp(15px,4vw,19px);
  font-weight:500;
  letter-spacing:.4px;
}
.status-detail{text-align:center;margin-top:6px;color:#adb8d1;font-size:13px}
.result-stage{
  position:relative;
  min-height:300px;
  display:grid;
  place-items:center;
  margin:-5px auto -9px;
}
.result-stage::before{
  content:"";
  position:absolute;
  left:50%;
  bottom:38px;
  width:88%;
  height:92px;
  transform:translateX(-50%);
  opacity:.33;
  background:
    linear-gradient(155deg,transparent 49%,#080d25 50%) left bottom/38% 100% no-repeat,
    linear-gradient(205deg,transparent 49%,#090d28 50%) right bottom/42% 100% no-repeat;
  clip-path:polygon(0 100%,0 65%,9% 52%,17% 70%,27% 39%,37% 65%,48% 29%,58% 64%,69% 41%,80% 68%,91% 47%,100% 70%,100% 100%);
}
.result-orbit{
  position:relative;
  width:min(73vw,390px);
  aspect-ratio:1;
  display:grid;
  place-items:center;
  border-radius:50%;
  background:
    radial-gradient(circle at center,#070716 0 56%,transparent 57%),
    conic-gradient(from 215deg,#149eff 0 19%,rgba(31,87,255,.08) 25% 49%,#c54aff 57% 76%,rgba(154,63,255,.08) 82% 100%);
  filter:drop-shadow(0 0 17px rgba(81,68,255,.42));
}
.result-orbit::before{
  content:"";
  position:absolute;
  inset:12px;
  border-radius:50%;
  border:1px solid rgba(117,87,255,.23);
  box-shadow:inset 0 0 28px rgba(61,65,255,.13),0 0 16px rgba(68,55,255,.16);
}
.result-orbit::after{
  content:"";
  position:absolute;
  inset:-4px;
  border-radius:50%;
  opacity:.36;
  background:repeating-conic-gradient(from 0deg,rgba(142,167,255,.68) 0deg .6deg,transparent .6deg 4deg);
  -webkit-mask:radial-gradient(circle,transparent 0 72%,#000 72.7% 74%,transparent 74.8%);
  mask:radial-gradient(circle,transparent 0 72%,#000 72.7% 74%,transparent 74.8%);
}
.big{
  position:relative;
  z-index:2;
  transform:translateY(-2px);
  color:transparent;
  background:linear-gradient(105deg,#c6efff 3%,#ffffff 47%,#ffd8ff 66%,#e96bff 100%);
  -webkit-background-clip:text;
  background-clip:text;
  font-size:clamp(108px,30vw,174px);
  line-height:.82;
  font-weight:900;
  letter-spacing:-11px;
  padding-right:8px;
  text-shadow:none;
  filter:drop-shadow(-5px 0 5px rgba(18,151,255,.54)) drop-shadow(7px 2px 7px rgba(221,66,255,.56));
}
.blink-change{animation:resultBlink .82s ease-in-out 1}
.big.pre-spin-change{animation:preSpinBigChange .58s cubic-bezier(.22,.72,.25,1) 1}
.market-value.pre-spin-change{animation:preSpinMarketChange .58s cubic-bezier(.22,.72,.25,1) 1}
@keyframes resultBlink{
  0%{
    opacity:1;
    transform:translateY(-2px) scale(1);
  }

  45%{
    opacity:0;
    transform:translateY(-2px) scale(.96);
  }

  55%{
    opacity:0;
    transform:translateY(-2px) scale(.96);
  }

  100%{
    opacity:1;
    transform:translateY(-2px) scale(1);
  }
}
@keyframes preSpinBigChange{
  0%{opacity:.28;transform:translateY(8px) scale(.94);filter:blur(1.2px) drop-shadow(-4px 0 4px rgba(18,151,255,.34)) drop-shadow(6px 2px 5px rgba(221,66,255,.34))}
  58%{opacity:1;transform:translateY(-4px) scale(1.025);filter:blur(0) drop-shadow(-5px 0 5px rgba(18,151,255,.54)) drop-shadow(7px 2px 7px rgba(221,66,255,.56))}
  100%{opacity:1;transform:translateY(-2px) scale(1);filter:drop-shadow(-5px 0 5px rgba(18,151,255,.54)) drop-shadow(7px 2px 7px rgba(221,66,255,.56))}
}
@keyframes preSpinMarketChange{
  0%{opacity:.32;transform:translateY(6px) scale(.97);filter:blur(.7px)}
  58%{opacity:1;transform:translateY(-2px) scale(1.015);filter:blur(0)}
  100%{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}
}
.latest-label{
  position:relative;
  z-index:3;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:13px;
  margin-top:-15px;
  color:#f3efff;
  text-align:center;
  font-size:clamp(13px,3.6vw,17px);
  font-weight:800;
  letter-spacing:4px;
}
.latest-label::before,.latest-label::after{content:"";width:52px;height:2px;background:linear-gradient(90deg,transparent,#5c80ff,#fff);box-shadow:0 0 7px #7f63ff}
.latest-label::after{transform:scaleX(-1)}
.market{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-top:28px;
}
.market-box{
  position:relative;
  overflow:hidden;
  min-width:0;
  min-height:181px;
  padding:22px 18px 12px;
  border:1px solid var(--market-color);
  border-radius:23px;
  background:linear-gradient(155deg,rgba(5,15,35,.95),rgba(1,5,16,.97));
  box-shadow:inset 0 0 27px var(--market-glow),0 0 10px var(--market-glow);
}
.market-box.set-box{--market-color:#1ebaff;--market-glow:rgba(0,153,255,.22)}
.market-box.value-box{--market-color:#ed52f4;--market-glow:rgba(225,52,255,.20)}
.market-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.market-label{color:var(--market-color);font-size:clamp(17px,5vw,25px);font-weight:900;letter-spacing:1.5px;text-shadow:0 0 9px var(--market-color)}
.market-icon{width:36px;height:28px;color:var(--market-color);filter:drop-shadow(0 0 5px var(--market-color))}
.market-value{
  overflow:hidden;
  margin-top:25px;
  color:var(--market-color);
  font-size:clamp(24px,7.5vw,43px);
  font-weight:900;
  line-height:1;
  letter-spacing:.5px;
  white-space:nowrap;
  text-shadow:0 0 13px var(--market-glow);
}
.trend{position:absolute;left:17px;right:17px;bottom:13px;width:calc(100% - 34px);height:37px;color:var(--market-color);opacity:.84;filter:drop-shadow(0 0 4px currentColor)}
.trend polyline{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.round-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin-top:16px}
.round-card{
  --tone:#3ab7ff;
  position:relative;
  overflow:hidden;
  min-height:170px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:flex-start;
  padding:18px 9px 10px;
  border:1.5px solid var(--tone);
  border-radius:22px;
  background:
    radial-gradient(circle at 50% 105%,color-mix(in srgb,var(--tone) 18%,transparent),transparent 55%),
    linear-gradient(160deg,rgba(4,9,25,.98),rgba(2,3,13,.99));
  box-shadow:inset 0 0 26px color-mix(in srgb,var(--tone) 13%,transparent),0 0 9px color-mix(in srgb,var(--tone) 48%,transparent);
}
.round-card::after{content:"";position:absolute;inset:auto 12% 0;height:1px;background:var(--tone);box-shadow:0 0 12px var(--tone);opacity:.55}
.round-card.tone-1{--tone:#26a9ff}.round-card.tone-2{--tone:#df67ff}.round-card.tone-3{--tone:#4defff}.round-card.tone-4{--tone:#ffb13f}.round-card.tone-5{--tone:#7dff56}.round-card.tone-6{--tone:#ff66d9}
.published-check{
  position:absolute;
  z-index:2;
  top:9px;
  right:9px;
  width:26px;
  height:26px;
  display:grid;
  place-items:center;
  border:1px solid #baffd2;
  border-radius:50%;
  background:linear-gradient(145deg,#63ff9a,#16d96c);
  color:#021109;
  font-size:17px;
  font-weight:1000;
  line-height:1;
  text-shadow:none;
  box-shadow:0 0 7px #32ff88,0 0 15px rgba(50,255,136,.75),inset 0 1px 2px #ffffff99;
  animation:publishedCheckPop .35s cubic-bezier(.2,.9,.25,1.35) both;
}
@keyframes publishedCheckPop{from{opacity:0;transform:scale(.4) rotate(-18deg)}to{opacity:1;transform:scale(1) rotate(0)}}
.round-time{display:flex;align-items:center;justify-content:center;gap:14px;padding:0 30px;color:#edf4ff;font-size:clamp(15px,4.8vw,22px);font-weight:500;letter-spacing:1.2px;white-space:nowrap}
.round-time .clock-icon{width:25px;height:25px;flex-basis:25px;color:var(--tone)}
.round-number{
  margin-top:19px;
  color:var(--tone);
  font-size:clamp(62px,19vw,102px);
  line-height:.9;
  font-weight:900;
  letter-spacing:-4px;
  text-shadow:0 0 12px color-mix(in srgb,var(--tone) 65%,transparent),0 0 25px color-mix(in srgb,var(--tone) 30%,transparent);
  filter:drop-shadow(0 5px 4px rgba(0,0,0,.45));
}
.round-number.waiting{opacity:.50;letter-spacing:1px}
.final-result-jump{animation:resultBlink .82s ease-in-out 1}
@keyframes finalMarketJump{
  0%{
    opacity:1;
    transform:translateY(0) scale(1);
  }

  45%{
    opacity:0;
    transform:translateY(-10px) scale(.97);
  }

  55%{
    opacity:0;
    transform:translateY(-10px) scale(.97);
  }

  100%{
    opacity:1;
    transform:translateY(0) scale(1);
  }
}
.round-card.just-published .round-number{animation:roundNumberDrop .58s cubic-bezier(.18,.88,.25,1.25) both}
.round-card.just-published .published-check{animation-delay:.16s}
@keyframes roundNumberDrop{
  0%{opacity:0;transform:translateY(-24px) scale(.82);filter:blur(1px)}
  70%{opacity:1;transform:translateY(4px) scale(1.06);filter:blur(0)}
  100%{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}
}
.history-button{
  position:relative;
  display:grid;
  grid-template-columns:57px 1fr 34px;
  align-items:center;
  min-height:78px;
  margin:18px 0 0;
  padding:8px 18px;
  border:1.5px solid transparent;
  border-radius:38px;
  color:#f7f6ff;
  background:
    linear-gradient(#050716,#050716) padding-box,
    linear-gradient(90deg,#009dff,#6267ff,#e258ff) border-box;
  box-shadow:inset 0 0 23px rgba(82,50,255,.13),0 0 13px rgba(72,79,255,.44);
  text-decoration:none;
  text-align:center;
  font-size:clamp(16px,4.7vw,23px);
  font-weight:600;
  letter-spacing:4px;
}
.history-symbol{position:relative;width:40px;height:40px;border:3px solid #2aa9ff;border-radius:50%;box-shadow:0 0 11px #277cff}
.history-symbol::before{content:"";position:absolute;left:-10px;top:5px;width:14px;height:14px;border-left:3px solid #4db8ff;border-bottom:3px solid #4db8ff;transform:rotate(40deg)}
.history-symbol::after{content:"";position:absolute;left:50%;top:50%;width:2px;height:11px;background:#50bdff;transform:translate(-50%,-100%);box-shadow:0 0 5px #50bdff}
.history-arrow{color:#f36aff;font-size:45px;line-height:1;text-shadow:0 0 12px #d74fff;transform:translateY(-1px)}
.menu-overlay{
  position:fixed;
  inset:0;
  z-index:1000;
  background:rgba(0,0,9,.72);
  backdrop-filter:blur(6px);
}
.menu-overlay[hidden]{display:none}
.side-menu{
  width:min(82vw,330px);
  height:100%;
  padding:calc(26px + env(safe-area-inset-top)) 18px 24px;
  border-right:1px solid rgba(91,181,255,.45);
  background:linear-gradient(180deg,#050819,#02030b);
  box-shadow:12px 0 38px rgba(0,0,0,.65),inset -8px 0 28px rgba(53,70,255,.08);
  animation:menuIn .23s ease-out;
}
@keyframes menuIn{from{transform:translateX(-102%)}to{transform:translateX(0)}}
.menu-close{display:block;margin-left:auto;width:44px;height:44px;border:1px solid #4da7ff;border-radius:50%;color:#fff;background:#081226;font-size:27px;cursor:pointer}
.menu-title{margin:23px 8px 28px;color:#f4f8ff;font-size:28px;font-weight:900}
.menu-links{display:grid;gap:12px}
.menu-links a{display:flex;align-items:center;min-height:54px;padding:14px 16px;border:1px solid rgba(92,144,255,.28);border-radius:15px;color:#eaf4ff;background:rgba(10,17,42,.78);text-decoration:none;font-weight:800}
.telegram-modal{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,7,.78);backdrop-filter:blur(7px)}
.telegram-modal[hidden]{display:none}
.telegram-dialog{width:min(100%,560px);max-height:calc(100vh - 36px);overflow:auto;padding:24px 19px;border:1px solid #5576ff;border-radius:25px;color:#eef4ff;background:linear-gradient(155deg,#091029,#030511);box-shadow:0 0 22px rgba(75,83,255,.55),0 22px 70px rgba(0,0,0,.72)}
.telegram-title{margin:0;color:#e9efff;text-align:center;font-size:24px;font-weight:900;text-shadow:0 0 9px #6c65ff}
.telegram-copy{margin-top:18px;color:#cfd8ec;font-size:15px;line-height:1.75}
.telegram-copy p{margin:0 0 13px}.telegram-link-text{overflow-wrap:anywhere;color:#53c8ff;font-weight:800}
.telegram-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:19px}
.telegram-join,.telegram-close{display:flex;align-items:center;justify-content:center;min-height:49px;padding:12px 14px;border:0;border-radius:13px;font-size:15px;font-weight:900;text-decoration:none;cursor:pointer}
.telegram-join{color:#fff;background:linear-gradient(90deg,#139cdf,#6476ff)}.telegram-close{color:#f1f4ff;background:#222a3e}
.telegram-join:focus-visible,.telegram-close:focus-visible,.menu-button:focus-visible,.menu-close:focus-visible{outline:3px solid #f4c542;outline-offset:3px}
@media(max-width:600px){
  .app-shell{min-height:0;padding-bottom:2px}
  .top{grid-template-columns:38px 1fr auto;min-height:58px;padding:max(4px,env(safe-area-inset-top)) 9px 3px;gap:5px}
  .menu-button{width:35px;height:35px;border-radius:10px;gap:4px}.menu-button span{width:25px;height:2.5px}
  .brand{font-size:clamp(21px,6.5vw,27px);letter-spacing:-.8px}
  .status{min-width:70px;padding:7px 8px;gap:4px;font-size:10px;border-width:1px}.status-wave{font-size:12px}.status-dot{width:7px;height:7px}
  .wrap{padding:2px 14px 4px}
  .hero-card{padding:10px 8px 8px;border-radius:24px}.hero-card::before{inset:6px;border-radius:19px}
  .update-label{gap:7px;font-size:10px;letter-spacing:2px}.update-label .clock-icon{width:15px;height:15px;flex-basis:15px;border-width:1.5px}
  .clock-icon::before{height:4px}.clock-icon::after{height:3px}
  .updated{min-height:17px;margin-top:4px;font-size:12px;letter-spacing:.2px}.status-detail{margin-top:2px;font-size:10px}
  .result-stage{min-height:154px;margin:-2px auto -3px}.result-stage::before{bottom:20px;height:48px}
  .result-orbit{width:min(49vw,176px)}.result-orbit::before{inset:7px}.result-orbit::after{inset:-2px}
  .big{font-size:clamp(70px,22vw,92px);letter-spacing:-6px;padding-right:5px}
  .latest-label{gap:7px;margin-top:-2px;font-size:10px;letter-spacing:2.2px}.latest-label::before,.latest-label::after{width:30px;height:1px}
  .market{gap:7px;margin-top:8px}.market-box{min-height:91px;padding:9px 9px 5px;border-radius:15px}
  .market-label{font-size:14px;letter-spacing:.8px}.market-icon{width:25px;height:19px}.market-value{margin-top:11px;font-size:clamp(20px,6.5vw,27px)}
  .trend{left:9px;right:9px;bottom:5px;width:calc(100% - 18px);height:20px}
  .round-grid{gap:7px;margin-top:8px}.round-card{min-height:79px;padding:7px 5px 5px;border-radius:14px;border-width:1px}
  .published-check{top:5px;right:5px;width:19px;height:19px;font-size:12px;border-width:1px}
  .round-time{gap:6px;padding:0 20px;font-size:12px;letter-spacing:.5px}.round-time .clock-icon{width:16px;height:16px;flex-basis:16px;border-width:1.5px}
  .round-number{margin-top:8px;font-size:clamp(39px,12.5vw,51px);letter-spacing:-2px}.round-number.waiting{letter-spacing:0}
  .history-button{min-height:49px;grid-template-columns:37px 1fr 20px;margin-top:8px;padding:5px 10px;border-radius:25px;font-size:13px;letter-spacing:2px}
  .history-symbol{width:27px;height:27px;border-width:2px}.history-symbol::before{left:-7px;top:3px;width:10px;height:10px;border-width:0 0 2px 2px}.history-symbol::after{height:7px}.history-arrow{font-size:28px}
}
@media(max-width:365px){
  .wrap{padding-left:10px;padding-right:10px}
  .status-wave{display:none}.status{min-width:72px}.brand{font-size:23px;letter-spacing:-1px}
  .update-label{font-size:12px;letter-spacing:2.2px}.market-value{font-size:22px}.round-time{font-size:14px;gap:8px}.round-number{font-size:58px}.history-button{font-size:15px;letter-spacing:2px}
}
</style>
</head>
<body oncopy="return false" oncut="return false" oncontextmenu="return false" onselectstart="return false" ondragstart="return false">
<div id="appViewport" class="app-viewport">
<div id="appShell" class="app-shell">
<header class="top">
  <button id="menuButton" class="menu-button" type="button" aria-label="Open menu" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <div class="brand">Tartay <strong>2D</strong></div>
  <div id="statusBadge" class="status active">
    <span id="statusText">LOADING</span><span class="status-wave">⌁</span><span class="status-dot"></span>
  </div>
</header>
<main class="wrap">
  <section class="hero-card">
    <div class="update-label"><span class="clock-icon" aria-hidden="true"></span>LAST UPDATED</div>
    <div id="updatedAt" class="updated">Loading...</div>
    <div id="statusDetail" class="status-detail"></div>
    <div class="result-stage">
      <div class="result-orbit"><div id="bigResult" class="big">--</div></div>
    </div>
    <div class="latest-label">LATEST 2D RESULT</div>
    <div class="market">
      <article class="market-box set-box">
        <div class="market-head">
          <div class="market-label">SET</div>
          <svg class="market-icon" viewBox="0 0 40 30" aria-hidden="true"><polyline points="2,26 12,16 18,21 29,7 38,11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M30 7h8v8" fill="none" stroke="currentColor" stroke-width="3"/></svg>
        </div>
        <div id="liveSet" class="market-value">--</div>
        <svg class="trend" viewBox="0 0 240 42" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,31 10,27 18,30 29,22 42,28 55,25 68,32 81,27 94,28 107,17 119,21 131,11 143,15 154,14 166,20 179,14 191,16 204,8 217,12 229,7 240,2"/></svg>
      </article>
      <article class="market-box value-box">
        <div class="market-head">
          <div class="market-label">VALUE</div>
          <svg class="market-icon" viewBox="0 0 40 30" aria-hidden="true"><rect x="2" y="19" width="6" height="9" fill="currentColor"/><rect x="13" y="13" width="6" height="15" fill="currentColor"/><rect x="24" y="7" width="6" height="21" fill="currentColor"/><rect x="35" y="2" width="4" height="26" fill="currentColor"/></svg>
        </div>
        <div id="liveValue" class="market-value">--</div>
        <svg class="trend" viewBox="0 0 240 42" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,31 13,28 25,32 39,25 52,30 65,24 78,29 91,21 104,26 118,14 130,18 143,9 157,16 170,13 184,20 196,14 209,8 222,13 233,8 240,2"/></svg>
      </article>
    </div>
  </section>
  <section id="roundGrid" class="round-grid"></section>
  <a class="history-button" href="/history">
    <span class="history-symbol" aria-hidden="true"></span>
    <span>RESULT HISTORY</span>
    <span class="history-arrow" aria-hidden="true">›</span>
  </a>
</main>
</div>
</div>
<div id="menuOverlay" class="menu-overlay" hidden>
  <nav class="side-menu" aria-label="Main menu">
    <button id="menuClose" class="menu-close" type="button" aria-label="Close menu">×</button>
    <div class="menu-title">NewZealand 2D</div>
    <div class="menu-links">
      <a href="/app">⌂ &nbsp; Home</a>
      <a href="/history">◷ &nbsp; Result History</a>
      <a href="https://t.me/New_2d" target="_blank" rel="noopener noreferrer">➤ &nbsp; Telegram Channel</a>
    </div>
  </nav>
</div>
<div id="telegramModal" class="telegram-modal" role="dialog" aria-modal="true" aria-labelledby="telegramTitle">
  <section class="telegram-dialog">
    <h2 id="telegramTitle" class="telegram-title">📢 အသိပေးကြေညာချက်</h2>
    <div class="telegram-copy">
      <p><strong>Tartay 2D App မှ ကြိုဆိုပါတယ်။</strong></p>
      <p>🔔 အကောင့်အသုံးပြုမှု၊ ငွေသွင်း/ငွေထုတ်ခြင်းနှင့် အခြားအခက်အခဲများရှိပါက Telegram Channel မှတစ်ဆင့် ဆက်သွယ်မေးမြန်းနိုင်ပါသည်။</p>
      <p>ဝန်ဆောင်မှုအသုံးပြုသူများပြားနေချိန်တွင် အကြောင်းပြန်ရန် အချိန်အနည်းငယ်ကြာနိုင်သဖြင့် စိတ်ရှည်စွာ စောင့်ဆိုင်းပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။</p>
      <p>🎯 Tartay 2D သတင်းများ၊ နေ့စဉ်အချက်အလက်များနှင့် အစီအစဉ်များကို သိရှိရန် Telegram Channel သို့ ဝင်ရောက်ကြည့်ရှုနိုင်ပါသည်။</p>
      <p>🔗 Telegram Channel<br><span class="telegram-link-text">https://t.me/New_2d</span></p>
    </div>
    <div class="telegram-actions">
      <a class="telegram-join" href="https://t.me/New_2d" target="_blank" rel="noopener noreferrer">Telegram Channel သို့ ဝင်ရန်</a>
      <button id="telegramClose" class="telegram-close" type="button">ပိတ်မည်</button>
    </div>
  </section>
</div>
<script>
(function protectPublicAppContent(){
  function clearSelection(){
    var selection=window.getSelection?window.getSelection():null;
    if(selection&&selection.rangeCount){selection.removeAllRanges()}
  }
  ["copy","cut","contextmenu","selectstart","dragstart"].forEach(function(eventName){
    document.addEventListener(eventName,function(event){
      event.preventDefault();event.stopPropagation();clearSelection();return false;
    },true);
  });
  ["touchend","pointerup","mouseup","dblclick"].forEach(function(eventName){
    document.addEventListener(eventName,function(){setTimeout(clearSelection,0);setTimeout(clearSelection,80)},true);
  });
  document.addEventListener("keydown",function(event){
    var key=String(event.key||"").toLowerCase();
    var shortcut=event.ctrlKey||event.metaKey;
    if(shortcut&&["a","c","x","s","u","p"].includes(key)){
      event.preventDefault();event.stopPropagation();clearSelection();return false;
    }
  },true);
  document.addEventListener("selectionchange",clearSelection);
  document.querySelectorAll("img,a,button").forEach(function(node){node.setAttribute("draggable","false")});
})();
function esc(value){
  return String(value??"").replace(/[&<>"']/g,function(char){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char];
  });
}
function fitPublicAppToViewport(){
  var viewport=document.getElementById("appViewport");
  var shell=document.getElementById("appShell");
  if(!viewport||!shell){return}
  var mobile=window.matchMedia("(max-width: 600px) and (orientation: portrait)").matches;
  shell.style.transform="none";
  shell.style.width="min(100%,820px)";
  shell.style.maxWidth="820px";
  viewport.style.height="auto";
  document.body.classList.remove("screen-fitted");
  if(!mobile){return}
  requestAnimationFrame(function(){
    var available=Math.max(360,Math.floor((window.visualViewport?window.visualViewport.height:window.innerHeight)-2));
    var natural=Math.max(1,shell.scrollHeight);
    var scale=Math.min(1,available/natural);
    function applyWidth(nextScale){
      shell.style.width=(100/nextScale)+"%";
      shell.style.maxWidth=(820/nextScale)+"px";
    }
    applyWidth(scale);
    requestAnimationFrame(function(){
      natural=Math.max(1,shell.scrollHeight);
      scale=Math.min(1,available/natural);
      applyWidth(scale);
      shell.style.transform="scale("+scale+")";
      viewport.style.height=Math.ceil(natural*scale)+"px";
      document.body.classList.toggle("screen-fitted",scale<0.999);
    });
  });
}
function scheduleFitPublicApp(){
  if(window.fitPublicAppTimer){clearTimeout(window.fitPublicAppTimer)}
  window.fitPublicAppTimer=setTimeout(fitPublicAppToViewport,40);
}
function updateBlink(id,value){
  var node=document.getElementById(id);
  if(!node){return}
  node.textContent=String(value??"--");
}
function stopNumberAnimations(){
  ["bigResult","liveSet","liveValue"].forEach(function(id){
    var node=document.getElementById(id);
    if(!node){return}
    node.classList.remove("blink-change");node.style.opacity="1";
  });
}
function blinkNumbers(){
  if(window.numberAnimationHeld||window.preSpinActive){return}
  ["bigResult","liveSet","liveValue"].forEach(function(id){
    var node=document.getElementById(id);
    if(!node||node.textContent.trim()==="--"){return}
    node.classList.remove("blink-change");void node.offsetWidth;node.classList.add("blink-change");
  });
}
function setNumberAnimationHold(isHeld,resumeAtMs,serverNow){
  window.numberAnimationHeld=Boolean(isHeld);
  if(window.numberAnimationResumeTimer){clearTimeout(window.numberAnimationResumeTimer);window.numberAnimationResumeTimer=null}
  if(window.numberAnimationHeld){stopNumberAnimations()}
  var resumeAt=Number(resumeAtMs)||0;
  var now=Number(serverNow)||Date.now();
  if(window.numberAnimationHeld&&resumeAt>now){
    window.numberAnimationResumeTimer=setTimeout(function(){window.numberAnimationResumeTimer=null;loadApp(true)},Math.max(50,resumeAt-now+50));
  }
}
["bigResult","liveSet","liveValue"].forEach(function(id){
  document.getElementById(id).addEventListener("animationend",function(){this.classList.remove("blink-change");this.style.opacity="1"});
});
function setStatus(status){
  var badge=document.getElementById("statusBadge");
  var text=document.getElementById("statusText");
  text.textContent=status.label||"LIVE";
  badge.className="status "+(status.code||"active");
  var detail=document.getElementById("statusDetail");
  detail.textContent=status.detail||"";
  detail.style.display=status.detail?"block":"none";
}
function startClock(serverNow,isStopped){
  window.serverClockBase=Number(serverNow)||Date.now();
  window.serverClockStartedAt=performance.now();
  window.appIsStopped=Boolean(isStopped);
  window.appConnectionLost=false;
  window.updateClock=function(){
    if(window.appConnectionLost){document.getElementById("updatedAt").textContent="Connection Lost — Retrying...";return}
    var elapsed=performance.now()-window.serverClockStartedAt;
    var current=new Date(window.serverClockBase+elapsed).toLocaleString("en-GB",{
      timeZone:"Asia/Yangon",day:"2-digit",month:"2-digit",year:"numeric",
      hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true
    }).replace(/\b(am|pm)\b/gi,function(period){return period.toUpperCase()});
    document.getElementById("updatedAt").textContent=current;
  };
  window.updateClock();
  if(!window.clockTimer){window.clockTimer=setInterval(window.updateClock,1000)}
}
function waitMs(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
var PRE_SPIN_LEAD_MS=15*1000;
var PRE_SPIN_STEP_MS=5*1000;
function estimatedServerNow(){
  if(Number.isFinite(Number(window.serverClockBase))&&Number.isFinite(Number(window.serverClockStartedAt))){
    return Number(window.serverClockBase)+(performance.now()-Number(window.serverClockStartedAt));
  }
  return Date.now();
}
function nextPreSpinFrame(){
  var frames=Array.isArray(window.preSpinFrames)?window.preSpinFrames:[];
  if(!frames.length){return null}
  var previous=String(window.lastPreSpinFrameResult||"");
  var candidates=frames.filter(function(frame){
    return frame&&/^\d{2}$/.test(String(frame.result||""))&&String(frame.result)!==previous;
  });
  if(!candidates.length){candidates=frames.slice()}
  var frame=candidates[Math.floor(Math.random()*candidates.length)]||null;
  if(frame){window.lastPreSpinFrameResult=String(frame.result||"")}
  return frame;
}
var PRE_SPIN_BLINK_GAP_MS=3500;
function clearPreSpinBlinkTimers(){
  (window.preSpinBlinkTimers||[]).forEach(function(timer){clearTimeout(timer)});
  window.preSpinBlinkTimers=[];
}
function triggerPreSpinBlink(){
  if(!window.preSpinActive){return}
  var nodes=[
    document.getElementById("bigResult"),
    document.getElementById("liveSet"),
    document.getElementById("liveValue")
  ];
  if(nodes.some(function(node){return !node||node.textContent.trim()==="--"})){return}
  nodes.forEach(function(node){node.classList.remove("blink-change","pre-spin-change")});
  void nodes[0].offsetWidth;
  nodes.forEach(function(node){node.classList.add("blink-change")});
}
function startPreSpinBlinkCycle(){
  clearPreSpinBlinkTimers();
  triggerPreSpinBlink();
  window.preSpinBlinkTimers=[
    setTimeout(triggerPreSpinBlink,PRE_SPIN_BLINK_GAP_MS),
    setTimeout(triggerPreSpinBlink,PRE_SPIN_BLINK_GAP_MS*2)
  ];
}
function showNextPreSpinFrame(){
  if(!window.preSpinActive){return}
  var frame=nextPreSpinFrame();
  if(!frame){return}
  var nodes=[
    document.getElementById("bigResult"),
    document.getElementById("liveSet"),
    document.getElementById("liveValue")
  ];
  if(nodes.some(function(node){return !node})){return}
  nodes[0].textContent=String(frame.result||"--");
  nodes[1].textContent=String(frame.set||"--");
  nodes[2].textContent=String(frame.value||"--");
  startPreSpinBlinkCycle();
}
function stopPreSpin(clearTarget){
  window.preSpinActive=false;
  if(window.preSpinStartTimer){clearTimeout(window.preSpinStartTimer);window.preSpinStartTimer=null}
  if(window.preSpinInterval){clearInterval(window.preSpinInterval);window.preSpinInterval=null}
  if(window.preSpinStopTimer){clearTimeout(window.preSpinStopTimer);window.preSpinStopTimer=null}
  clearPreSpinBlinkTimers();
  ["bigResult","liveSet","liveValue"].forEach(function(id){
    var node=document.getElementById(id);
    if(node){node.classList.remove("blink-change","pre-spin-change");node.style.opacity="1";node.style.transform="";node.style.filter=""}
  });
  if(clearTarget!==false){window.preSpinTargetMs=0}
}
function beginPreSpin(targetMs){
  var target=Number(targetMs)||0;
  if(!target||estimatedServerNow()>=target){return}
  if(window.preSpinActive&&Number(window.preSpinTargetMs||0)===target){return}
  if(!Array.isArray(window.preSpinFrames)||!window.preSpinFrames.length){return}
  stopPreSpin(false);
  window.preSpinTargetMs=target;
  window.preSpinActive=true;
  showNextPreSpinFrame();
  window.preSpinInterval=setInterval(showNextPreSpinFrame,PRE_SPIN_STEP_MS);
  window.preSpinStopTimer=setTimeout(function(){
    stopPreSpin(false);
    window.preSpinAwaitingPublish=true;
    publishBoundaryBurst(target);
  },Math.max(20,target-estimatedServerNow()+20));
}
function schedulePreSpin(targetMs,serverNow){
  var target=Number(targetMs)||0;
  var now=Number(serverNow)||estimatedServerNow();
  if(window.preSpinStartTimer){clearTimeout(window.preSpinStartTimer);window.preSpinStartTimer=null}
  if(!target){
    if(window.preSpinActive){stopPreSpin()}
    window.preSpinAwaitingPublish=false;
    return;
  }
  if(window.preSpinAwaitingPublish&&Number(window.preSpinTargetMs||0)!==target){window.preSpinAwaitingPublish=false}
  if(window.preSpinActive&&Number(window.preSpinTargetMs||0)!==target){stopPreSpin()}
  window.preSpinTargetMs=target;
  var untilTarget=target-now;
  if(untilTarget<=0){return}
  if(untilTarget<=PRE_SPIN_LEAD_MS){
    beginPreSpin(target);
    return;
  }
  window.preSpinStartTimer=setTimeout(function(){
    window.preSpinStartTimer=null;
    beginPreSpin(target);
  },Math.max(20,untilTarget-PRE_SPIN_LEAD_MS));
}
var FINAL_FIRST_JUMP_DELAY_MS=20;
var FINAL_ALL_JUMP_GAP_MS=3500;
var FINAL_ROUND_REVEAL_DELAY_MS=8000;
function latestPublishedRound(rounds){
  var published=(Array.isArray(rounds)?rounds:[]).filter(function(round){
    return round&&round.status==="published"&&/^\d{2}$/.test(String(round.result||""));
  });
  published.sort(function(first,second){
    return Number(second.publishedAtMs||0)-Number(first.publishedAtMs||0);
  });
  return published[0]||null;
}
function renderRoundGrid(rounds,revealPublishedAtMs){
  var revealMs=Number(revealPublishedAtMs)||0;
  document.getElementById("roundGrid").innerHTML=(Array.isArray(rounds)?rounds:[]).map(function(round,index){
    var published=round.status==="published"&&/^\d{2}$/.test(String(round.result||""));
    var justPublished=published&&revealMs>0&&Number(round.publishedAtMs||0)===revealMs;
    return '<article class="round-card tone-'+((index%6)+1)+(justPublished?' just-published':'')+'">'+
      (published?'<span class="published-check" aria-label="Published">✓</span>':'')+
      '<div class="round-time"><span class="clock-icon" aria-hidden="true"></span><span>'+esc(round.time)+'</span></div>'+
      '<div class="round-number '+(published?"":"waiting")+'">'+(published?esc(round.result):"--")+'</div></article>';
  }).join("");
}
function clearFinalRoundRevealTimers(){
  (window.finalRoundRevealTimers||[]).forEach(function(timer){clearTimeout(timer)});
  window.finalRoundRevealTimers=[];
}
function triggerFinalAllJump(){
  var nodes=[
    document.getElementById("bigResult"),
    document.getElementById("liveSet"),
    document.getElementById("liveValue")
  ];

  if(nodes.some(function(node){
    return !node||node.textContent.trim()==="--";
  })){return}

  nodes.forEach(function(node){
    node.classList.remove(
      "blink-change",
      "pre-spin-change",
      "final-result-jump"
    );
  });

  void nodes[0].offsetWidth;

  nodes.forEach(function(node){
    node.classList.add("final-result-jump");
  });
}
function finishFinalRoundReveal(){
  var data=window.finalRoundRevealData;
  var latest=data?latestPublishedRound(data.rounds):null;
  var publishedAtMs=latest
    ?Number(latest.publishedAtMs||0)
    :Number(window.finalRoundRevealPublishedAtMs||0);

  ["bigResult","liveSet","liveValue"].forEach(function(id){
    var node=document.getElementById(id);
    if(!node){return}

    node.classList.remove(
      "final-result-jump",
      "blink-change",
      "pre-spin-change"
    );

    node.style.opacity="1";
  });

  if(data){
    renderRoundGrid(data.rounds,publishedAtMs);
  }

  window.lastFinalRoundRevealAtMs=publishedAtMs;
  window.finalRoundRevealActive=false;
  window.finalRoundRevealData=null;
  window.finalRoundRevealPublishedAtMs=0;
  clearFinalRoundRevealTimers();
  scheduleFitPublicApp();
}
function beginFinalRoundReveal(data){
  var latest=latestPublishedRound(data&&data.rounds);
  if(!latest){return false}

  var publishedAtMs=Number(latest.publishedAtMs||0);

  if(window.finalRoundRevealActive){
    window.finalRoundRevealData=data;
    return true;
  }

  if(
    publishedAtMs>0&&
    publishedAtMs===Number(window.lastFinalRoundRevealAtMs||0)
  ){
    return false;
  }

  if(window.preSpinActive){
    stopPreSpin(false);
  }

  window.preSpinAwaitingPublish=false;
  clearFinalRoundRevealTimers();
  window.finalRoundRevealActive=true;
  window.finalRoundRevealData=data;
  window.finalRoundRevealPublishedAtMs=publishedAtMs;

  var big=document.getElementById("bigResult");
  var setNode=document.getElementById("liveSet");
  var valueNode=document.getElementById("liveValue");

  if(big){
    big.textContent=String(data.live.result||"--");
  }

  if(setNode){
    setNode.textContent=String(data.live.set||"--");
  }

  if(valueNode){
    valueNode.textContent=String(data.live.value||"--");
  }

  [big,setNode,valueNode].forEach(function(node){
    if(!node){return}

    node.classList.remove(
      "blink-change",
      "pre-spin-change",
      "final-result-jump"
    );
  });

  window.finalRoundRevealTimers=[
    setTimeout(
      triggerFinalAllJump,
      FINAL_FIRST_JUMP_DELAY_MS
    ),

    setTimeout(
      triggerFinalAllJump,
      FINAL_FIRST_JUMP_DELAY_MS+FINAL_ALL_JUMP_GAP_MS
    ),

    setTimeout(
      triggerFinalAllJump,
      FINAL_FIRST_JUMP_DELAY_MS+(FINAL_ALL_JUMP_GAP_MS*2)
    ),

    setTimeout(
      finishFinalRoundReveal,
      FINAL_ROUND_REVEAL_DELAY_MS
    )
  ];

  return true;
}
async function publishBoundaryBurst(targetMs){
  if(window.publishBurstRunning){return}
  window.publishBurstRunning=true;
  window.lastBurstTarget=Number(targetMs)||0;
  try{
    for(var attempt=0;attempt<__PUBLISH_BURST_ATTEMPTS__;attempt++){
      await loadApp(true);
      if(Number(window.currentNextAutoPublishAtMs||0)!==Number(targetMs||0)){break}
      await waitMs(__PUBLISH_BURST_INTERVAL_MS__);
    }
  }finally{window.publishBurstRunning=false}
}
function scheduleExactPublishRefresh(targetMs,serverNow){
  var target=Number(targetMs)||0;
  window.currentNextAutoPublishAtMs=target;
  if(window.publishBoundaryTimer){clearTimeout(window.publishBoundaryTimer);window.publishBoundaryTimer=null}
  if(!target){return}
  var delay=target-(Number(serverNow)||Date.now());
  if(delay<=0){
    if(Number(window.lastBurstTarget||0)!==target){window.publishBoundaryTimer=setTimeout(function(){publishBoundaryBurst(target)},50)}
    return;
  }
  window.lastBurstTarget=0;
  window.publishBoundaryTimer=setTimeout(function(){publishBoundaryBurst(target)},Math.max(50,delay+50));
}
async function loadApp(fromBoundaryBurst){
  try{
    var response=await fetch("/api/state?t="+Date.now(),{cache:"no-store"});
    var data=await response.json();
    if(!response.ok||!data.success){throw new Error(data.message||"Data load failed")}
    window.appConnectionLost=false;
    var livePublished=data.live.status==="published";
    var latestPublished=latestPublishedRound(data.rounds);
    var shouldStageFinal=Boolean(
      livePublished&&
      latestPublished&&
      Number(latestPublished.publishedAtMs||0)!==Number(window.lastFinalRoundRevealAtMs||0)
    );

    if(shouldStageFinal){
      beginFinalRoundReveal(data);
    }else if(livePublished&&!window.finalRoundRevealActive){
      if(window.preSpinActive){stopPreSpin(false)}
      window.preSpinAwaitingPublish=false;
    }

    if(!window.finalRoundRevealActive&&((!window.preSpinActive&&!window.preSpinAwaitingPublish)||livePublished)){
      updateBlink("bigResult",data.live.result||"--");
      updateBlink("liveSet",data.live.set||"--");
      updateBlink("liveValue",data.live.value||"--");
    }else if(window.finalRoundRevealActive){
      window.finalRoundRevealData=data;
    }

    setStatus(data.appStatus||{code:"active",label:"LIVE"});
    var animationHeld=livePublished||data.live.status==="paused";
    setNumberAnimationHold(animationHeld,data.live.resumeAtMs,data.serverNow);
    startClock(data.serverNow,animationHeld);
    window.preSpinFrames=(Array.isArray(data.preSpinFrames)?data.preSpinFrames:[]).filter(function(frame){
      return frame&&/^\d{2}$/.test(String(frame.result||""))&&String(frame.set||"")&&String(frame.value||"");
    });
    scheduleExactPublishRefresh(data.nextAutoPublishAtMs,data.serverNow);
    schedulePreSpin(data.nextAutoPublishAtMs,data.serverNow);
    if(!window.finalRoundRevealActive){renderRoundGrid(data.rounds,0)}
    scheduleFitPublicApp();
  }catch(error){
    window.appConnectionLost=true;
    setStatus({code:"offline",label:"OFFLINE",detail:"Connection ပြန်ချိတ်နေပါတယ်"});
    if(window.updateClock){window.updateClock()}
  }
}
function closeTelegramModal(){
  var modal=document.getElementById("telegramModal");
  if(modal){modal.hidden=true;document.body.style.overflow="";scheduleFitPublicApp()}
}
function initialiseTelegramModal(){
  var modal=document.getElementById("telegramModal");
  var closeButton=document.getElementById("telegramClose");
  if(!modal||!closeButton){return}
  const params = new URLSearchParams(window.location.search);

if (params.get("screenshot") === "1") {
    modal.hidden = true;
    return;
}

modal.hidden = false;
  closeButton.addEventListener("click",closeTelegramModal);
  modal.addEventListener("click",function(event){if(event.target===modal){closeTelegramModal()}});
  document.addEventListener("keydown",function(event){if(event.key==="Escape"&&!modal.hidden){closeTelegramModal()}});
  closeButton.focus();
}
function initialiseMenu(){
  var button=document.getElementById("menuButton");
  var overlay=document.getElementById("menuOverlay");
  var close=document.getElementById("menuClose");
  if(!button||!overlay||!close){return}
  function openMenu(){overlay.hidden=false;button.setAttribute("aria-expanded","true");document.body.style.overflow="hidden"}
  function closeMenu(){overlay.hidden=true;button.setAttribute("aria-expanded","false");document.body.style.overflow=""}
  button.addEventListener("click",openMenu);
  close.addEventListener("click",closeMenu);
  overlay.addEventListener("click",function(event){if(event.target===overlay){closeMenu()}});
  document.addEventListener("keydown",function(event){if(event.key==="Escape"&&!overlay.hidden){closeMenu()}});
}
if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(console.error)})}
initialiseMenu();
initialiseTelegramModal();
loadApp();
window.addEventListener("resize",scheduleFitPublicApp);
window.addEventListener("orientationchange",scheduleFitPublicApp);
if(window.visualViewport){window.visualViewport.addEventListener("resize",scheduleFitPublicApp)}
scheduleFitPublicApp();
setInterval(loadApp,__REFRESH_MS__);
setInterval(blinkNumbers,__BLINK_INTERVAL_MS__);
</script>
</body>
</html>`;

  return page
    .replace("__REFRESH_MS__", String(LIVE_REFRESH_MS))
    .replace("__BLINK_INTERVAL_MS__", String(BLINK_INTERVAL_MS))
    .replace("__PUBLISH_BURST_INTERVAL_MS__", String(PUBLISH_BURST_INTERVAL_MS))
    .replace("__PUBLISH_BURST_ATTEMPTS__", String(PUBLISH_BURST_ATTEMPTS));
}
function historyPage() {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#020611">
<link rel="icon" href="/favicon.ico">
<title>2D History</title>
<style>
:root{
  --page:#020611;
  --panel:#06101d;
  --result-bg:#07111e;
  --result-border:#172536;
  --white:#f5f7fb;
  --muted:#aab2bf;
}
*{box-sizing:border-box}

/* History page copy/selection protection */
html,
body,
.wrap,
.wrap *{
  -webkit-user-select:none !important;
  -moz-user-select:none !important;
  -ms-user-select:none !important;
  user-select:none !important;
  -webkit-touch-callout:none !important;
  -webkit-tap-highlight-color:transparent;
}

html{background:var(--page)}
body{
  margin:0;
  min-height:100vh;
  color:var(--white);
  background:
    radial-gradient(circle at 50% -140px,rgba(0,183,255,.10),transparent 430px),
    linear-gradient(180deg,#020611 0%,#01040b 100%);
  font-family:Arial,sans-serif;
}
.wrap{
  width:min(100%,820px);
  margin:auto;
  padding:0 12px calc(26px + env(safe-area-inset-bottom));
}
.topbar{
  position:sticky;
  top:0;
  z-index:30;
  display:grid;
  grid-template-columns:50px 1fr 50px;
  align-items:center;
  min-height:80px;
  padding-top:max(4px,env(safe-area-inset-top));
  background:rgba(2,6,17,.94);
  backdrop-filter:blur(14px);
  border-bottom:1px solid rgba(68,218,255,.10);
}
.topbar h1{
  margin:0;
  color:#f4fbff;
  text-align:center;
  font-size:28px;
  line-height:1;
  font-weight:900;
  letter-spacing:.2px;
  text-shadow:0 0 7px rgba(115,220,255,.48);
}
.icon-button{
  display:grid;
  place-items:center;
  width:44px;
  height:44px;
  padding:0;
  border:1px solid rgba(57,208,255,.55);
  border-radius:50%;
  color:#eefcff;
  background:#07101e;
  box-shadow:0 0 8px rgba(0,195,255,.28);
  text-decoration:none;
  cursor:pointer;
}
.icon-button:active{transform:scale(.96)}
.icon-button svg{
  width:26px;
  height:26px;
  stroke:currentColor;
}
#historyDate{
  position:fixed;
  left:-1000px;
  top:-1000px;
  width:1px;
  height:1px;
  opacity:0;
  pointer-events:none;
}
.history-list{
  display:grid;
  gap:20px;
  padding-top:16px;
}
.history-card{
  --neon:#35e7ff;
  --glow:rgba(53,231,255,.34);
  --soft:rgba(53,231,255,.16);
  position:relative;
  overflow:hidden;
  padding:17px 12px 19px;
  color:var(--neon);
  background:
    linear-gradient(145deg,rgba(8,17,31,.98),rgba(2,8,17,.99));
  border:1.6px solid var(--neon);
  border-radius:21px;
  box-shadow:
    0 0 7px var(--glow),
    0 0 16px var(--soft),
    inset 0 0 13px rgba(255,255,255,.018);
}
.history-card[data-tone="cyan"]{
  --neon:#31e3f1;
  --glow:rgba(49,227,241,.34);
  --soft:rgba(49,227,241,.15);
}
.history-card[data-tone="pink"]{
  --neon:#ff4ccf;
  --glow:rgba(255,76,207,.34);
  --soft:rgba(255,76,207,.15);
}
.history-card[data-tone="blue"]{
  --neon:#4c9dff;
  --glow:rgba(76,157,255,.34);
  --soft:rgba(76,157,255,.15);
}
.history-card[data-tone="yellow"]{
  --neon:#ffd52f;
  --glow:rgba(255,213,47,.34);
  --soft:rgba(255,213,47,.15);
}
.history-card[data-tone="green"]{
  --neon:#57ef76;
  --glow:rgba(87,239,118,.34);
  --soft:rgba(87,239,118,.15);
}
.card-date-row{
  display:flex;
  align-items:center;
  gap:11px;
  padding:2px 6px 14px;
}
.card-date-row svg{
  flex:0 0 auto;
  width:30px;
  height:30px;
  stroke:currentColor;
  filter:drop-shadow(0 0 4px var(--glow));
}
.card-date{
  font-size:25px;
  line-height:1;
  font-weight:900;
  letter-spacing:.6px;
  text-shadow:0 0 5px var(--glow);
}
.card-divider{
  height:1px;
  margin:0 4px 15px;
  background:linear-gradient(90deg,var(--neon),rgba(255,255,255,.06));
  opacity:.58;
}
.result-grid{
  display:grid;
  grid-template-columns:repeat(6,minmax(0,1fr));
  gap:5px;
}
.slot{
  min-width:0;
  text-align:center;
}
.slot-time{
  min-height:21px;
  color:var(--muted);
  font-size:10px;
  line-height:1.1;
  font-weight:800;
  white-space:nowrap;
  letter-spacing:-.28px;
}
.slot-result{
  display:grid;
  place-items:center;
  min-height:58px;
  margin-top:8px;
  color:var(--white);
  background:linear-gradient(180deg,#0a1625,#06101b);
  border:1px solid var(--result-border);
  border-radius:11px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.035),
    0 4px 10px rgba(0,0,0,.20);
  font-size:29px;
  line-height:1;
  font-weight:900;
  font-variant-numeric:tabular-nums;
  text-shadow:none;
}
.slot-result.waiting{
  color:#7c8796;
}
.message{
  display:none;
  margin-top:18px;
  padding:16px;
  color:#cdd8e2;
  background:rgba(5,14,28,.96);
  border:1px solid rgba(66,209,255,.26);
  border-radius:15px;
  text-align:center;
}
.loading .history-card{opacity:.58}
.empty-note{
  display:none;
  padding:26px 12px;
  color:#8fa0b2;
  text-align:center;
}
.history-note{
  margin:17px 0 0;
  color:#8f98a8;
  font-size:12px;
  text-align:center;
}
@media(min-width:560px){
  .history-list{gap:23px}
  .history-card{padding:20px 17px 22px}
  .card-date{font-size:29px}
  .slot-time{font-size:12px}
  .slot-result{min-height:68px;font-size:36px}
}
@media(max-width:390px){
  .wrap{padding-left:8px;padding-right:8px}
  .topbar{grid-template-columns:47px 1fr 47px}
  .topbar h1{font-size:24px}
  .icon-button{width:41px;height:41px}
  .history-card{padding:15px 7px 17px;border-radius:18px}
  .card-date-row{gap:8px;padding-left:4px}
  .card-date-row svg{width:26px;height:26px}
  .card-date{font-size:20px}
  .result-grid{gap:3px}
  .slot-time{font-size:8px;letter-spacing:-.45px}
  .slot-result{min-height:49px;font-size:23px;border-radius:9px}
}
</style>
</head>
<body oncopy="return false" oncut="return false" oncontextmenu="return false" onselectstart="return false" ondragstart="return false">
<main class="wrap">
  <header class="topbar">
    <a class="icon-button" href="/app" aria-label="Back to app">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2.3">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </a>

    <h1>2D History</h1>

    <button class="icon-button" type="button" onclick="openCalendar()" aria-label="Select date">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
        <rect x="3" y="5" width="18" height="16" rx="2"/>
        <path d="M16 3v4M8 3v4M3 10h18"/>
        <path d="M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2"/>
      </svg>
    </button>

    <input id="historyDate" type="date" aria-label="History date">
  </header>

  <div id="historyMessage" class="message">Loading...</div>
  <section id="historyList" class="history-list loading" aria-live="polite"></section>
  <div id="emptyNote" class="empty-note">History မရှိသေးပါ</div>
  <p class="history-note">Results are final and will be held for 2 minutes.</p>
</main>

<script>
(function protectHistoryContent(){
  function clearSelection(){
    var selection=window.getSelection?window.getSelection():null;
    if(selection&&selection.rangeCount){
      selection.removeAllRanges();
    }
  }

  ["copy","cut","contextmenu","selectstart","dragstart"].forEach(function(eventName){
    document.addEventListener(eventName,function(event){
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
      return false;
    },true);
  });

  ["touchend","pointerup","mouseup","dblclick"].forEach(function(eventName){
    document.addEventListener(eventName,function(){
      setTimeout(clearSelection,0);
      setTimeout(clearSelection,80);
    },true);
  });

  document.addEventListener("keydown",function(event){
    var key=String(event.key||"").toLowerCase();
    var shortcut=event.ctrlKey||event.metaKey;

    if(shortcut&&["a","c","x","s","u","p"].includes(key)){
      event.preventDefault();
      event.stopPropagation();
      clearSelection();
      return false;
    }
  },true);

  document.addEventListener("selectionchange",clearSelection);

  document.querySelectorAll("svg,a,button").forEach(function(node){
    node.setAttribute("draggable","false");
  });
})();

var HISTORY_TIMES=["09:00 AM","11:00 AM","01:00 PM","03:00 PM","05:00 PM","07:00 PM"];
var HISTORY_START_DATE="2026-06-01";
var HISTORY_TONES=["cyan","pink","blue","yellow","green"];

function esc(value){
  return String(value??"").replace(/[&<>"']/g,function(char){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char];
  });
}

function todayYangon(){
  var parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Yangon",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(new Date());

  var values={};
  parts.forEach(function(part){values[part.type]=part.value});
  return values.year+"-"+values.month+"-"+values.day;
}

function neonDate(dateText){
  return String(dateText||"").replace(/-/g,"/");
}

function resultForRound(items,roundNumber){
  var safe=Array.isArray(items)?items:[];
  var item=safe.find(function(record){
    return Number(record.round)===roundNumber;
  });

  var legacyEmpty=
    item&&
    String(item.result||"")==="00"&&
    Number(item.set||0)===0&&
    Number(item.value||0)===0;

  return item&&!legacyEmpty&&/^\d{2}$/.test(String(item.result||""))
    ?String(item.result)
    :"--";
}

function calendarIcon(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2">'+
    '<rect x="3" y="5" width="18" height="16" rx="2"/>'+
    '<path d="M16 3v4M8 3v4M3 10h18"/>'+
    '<path d="M7 14h2M11 14h2M15 14h2M7 18h2M11 18h2"/>'+
  '</svg>';
}

function renderHistory(records){
  var safe=Array.isArray(records)?records:[];

  var visible=safe.filter(function(record,index){
    return index===0||(Array.isArray(record.items)&&record.items.length>0);
  });

  document.getElementById("emptyNote").style.display=
    visible.length ? "none" : "block";

  document.getElementById("historyList").innerHTML=visible.map(function(record,index){
    var tone=HISTORY_TONES[index%HISTORY_TONES.length];

    var slots=HISTORY_TIMES.map(function(time,slotIndex){
      var result=resultForRound(record.items,slotIndex+1);

      return '<div class="slot">'+
        '<div class="slot-time">'+esc(time)+'</div>'+
        '<div class="slot-result '+(result==="--"?"waiting":"")+'">'+esc(result)+'</div>'+
      '</div>';
    }).join("");

    return '<article class="history-card" data-tone="'+tone+'">'+
      '<div class="card-date-row">'+
        calendarIcon()+
        '<div class="card-date">'+esc(neonDate(record.date))+'</div>'+
      '</div>'+
      '<div class="card-divider"></div>'+
      '<div class="result-grid">'+slots+'</div>'+
    '</article>';
  }).join("");

  document.getElementById("historyList").classList.remove("loading");
}

function historyDaysFromStart(endDate){
  var start=new Date(HISTORY_START_DATE+"T00:00:00Z");
  var end=new Date(String(endDate||todayYangon())+"T00:00:00Z");

  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<start){
    return 1;
  }

  return Math.min(
    120,
    Math.max(1,Math.floor((end-start)/86400000)+1)
  );
}

async function loadHistory(){
  var input=document.getElementById("historyDate");
  var date=input.value||todayYangon();
  var days=historyDaysFromStart(date);
  var message=document.getElementById("historyMessage");
  var list=document.getElementById("historyList");

  list.classList.add("loading");
  message.style.display="none";

  try{
    var response=await fetch(
      "/api/history?date="+encodeURIComponent(date)+"&days="+days,
      {cache:"no-store"}
    );

    var data=await response.json();

    if(!response.ok||!data.success){
      throw new Error(data.message||"History could not be loaded");
    }

    var records=Array.isArray(data.records)
      ?data.records
      :[{date:data.date||date,items:Array.isArray(data.items)?data.items:[]}];

    renderHistory(records);
  }catch(error){
    renderHistory([{date:date,items:[]}]);
    message.style.display="block";
    message.textContent=error.message||"History could not be loaded.";
  }
}

function openCalendar(){
  var input=document.getElementById("historyDate");

  if(typeof input.showPicker==="function"){
    input.showPicker();
  }else{
    input.click();
  }
}

var historyDate=document.getElementById("historyDate");
historyDate.min=HISTORY_START_DATE;
historyDate.max=todayYangon();
historyDate.value=todayYangon();
historyDate.addEventListener("change",loadHistory);
loadHistory();
</script>
</body>
</html>`;
}

function adminPage(siteKey) {
  const page = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#075ca8">
<link rel="icon" href="/favicon.ico">
<title>Tartay 2D Admin</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
<style>
*{box-sizing:border-box}
body{margin:0;padding:16px;background:#f4f7fb;font-family:Arial,sans-serif}
.wrap{max-width:820px;margin:auto}.card{margin-bottom:14px;padding:16px;background:#fff;border-radius:17px;box-shadow:0 4px 14px #0001}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
input,select,button,textarea{width:100%;padding:13px;margin-top:7px;border:1px solid #ddd;border-radius:10px;font-size:16px}
button{border:0;background:#075ca8;color:#fff;font-weight:800;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}
.red{background:#c62828}.green{background:#2e8b57}.orange{background:#ef7d00}.purple{background:#6d28d9}.gray{background:#667085}
.big{color:#0b5faa;text-align:center;font-size:62px;font-weight:900}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer}
.editor{display:none;margin-top:12px}.editor.open{display:block}.links{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.links a{padding:13px;background:#075ca8;color:#fff;border-radius:10px;text-align:center;text-decoration:none;font-weight:700}
#message{position:sticky;top:8px;z-index:99;min-height:20px;padding:12px;background:#fff3cd;color:#7a5b00;border-radius:10px;text-align:center;font-weight:700}
.section-title{margin:0 0 12px;color:#075ca8}.old-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.old-item{padding:12px;background:#f4f7fb;border-radius:12px}.old-time{text-align:center;font-weight:900}.old-input{text-align:center;font-size:25px;font-weight:900}
.note{padding:10px;background:#eef6ff;border-radius:10px;color:#344054;font-size:14px}.danger-note{background:#fff0f0;color:#9b1c1c}
.log-box{max-height:340px;overflow:auto;margin-top:10px;padding:10px;background:#101828;color:#e5e7eb;border-radius:10px;font-family:monospace;font-size:12px;white-space:pre-wrap}
#turnstileContainer{position:fixed;right:12px;bottom:12px;z-index:9999}
@media(max-width:620px){.grid,.grid3,.links{grid-template-columns:1fr}}
</style>
</head>
<body>
<main class="wrap">
<h1>Tartay 2D Admin</h1>
<section class="card">
  <label>Admin Password</label>
  <input id="adminPassword" type="password" autocomplete="current-password" placeholder="Admin password" onkeydown="if(event.key==='Enter'){loadAdmin()}">
  <button type="button" data-admin-action onclick="loadAdmin()">Open Admin / Load Data</button>
  <button type="button" class="red" onclick="forgetAdminPassword()">Logout Admin</button>
  <div id="turnstileContainer"></div>
</section>
<nav class="links"><a href="/app" target="_blank" rel="noopener noreferrer">Open App</a><a href="/history" target="_blank" rel="noopener noreferrer">Result History</a></nav>
<p id="message">Admin password ထည့်ပြီး ခလုတ်နှိပ်ပါ</p>

<section class="card">
  <div class="head"><b>Live SET / VALUE</b><span id="liveBadge">Active</span></div>
  <div id="liveResult" class="big">--</div>
  <div class="grid">
    <div><label>Base SET</label><input id="baseSet" inputmode="decimal"></div>
    <div><label>Base VALUE</label><input id="baseValue" inputmode="decimal"></div>
  </div>
  <button type="button" data-admin-action onclick="saveBaseValues()">Save Base Values</button>
  <button type="button" id="toggleButton" data-admin-action class="red" onclick="toggleLive()">Pause Live Data</button>
</section>

<section class="card">
  <h2 class="section-title">Add Old History</h2>
  <label>History Date</label><input id="oldHistoryDate" type="date">
  <div id="oldHistoryInputs" class="old-grid"></div>
  <button type="button" data-admin-action class="orange" onclick="saveOldHistoryFromAdmin()">Save Old History</button>
</section>

<section class="card">
  <h2 class="section-title">History Edit / Delete</h2>
  <div class="grid3">
    <div><label>Date</label><input id="historyEditDate" type="date"></div>
    <div><label>Round</label><select id="historyEditRound"></select></div>
    <div><label>2D Result</label><input id="historyEditResult" inputmode="numeric" maxlength="2" placeholder="00"></div>
  </div>
  <div class="grid">
    <div><label>SET (Old History ဆိုလျှင် အလွတ်ထားနိုင်)</label><input id="historyEditSet" inputmode="decimal"></div>
    <div><label>VALUE (Old History ဆိုလျှင် အလွတ်ထားနိုင်)</label><input id="historyEditValue" inputmode="decimal"></div>
  </div>
  <button type="button" data-admin-action class="green" onclick="saveHistoryRecord()">Save / Edit History Round</button>
  <button type="button" data-admin-action class="red" onclick="deleteHistoryRecord()">Delete History Round</button>
</section>

<section class="card">
  <h2 class="section-title">Data Backup / Restore</h2>
  <p class="note">State နှင့် History အားလုံးကို JSON File အဖြစ် သိမ်းနိုင်ပါတယ်။ Restore မလုပ်ခင် Safety Backup အလိုအလျောက်ဖန်တီးပါမယ်။</p>
  <button type="button" data-admin-action class="green" onclick="downloadFullBackup()">Download Full Backup</button>
  <label>Restore JSON File</label><input id="restoreFile" type="file" accept=".json,application/json">
  <label>Restore Mode</label>
  <select id="restoreMode">
    <option value="full_replace">Full Replace — State + History အကုန်ပြန်ထား</option>
    <option value="history_merge">History Merge — ရှိတာနဲ့ပေါင်း</option>
    <option value="history_replace">History Replace — History အကုန်အစားထိုး</option>
  </select>
  <p class="note danger-note">Full Replace/History Replace သည် လက်ရှိ Data ကိုပြောင်းမည်။ Confirmation နှစ်ကြိမ်စစ်ပြီးမှလုပ်ပါမယ်။</p>
  <button type="button" data-admin-action class="purple" onclick="restoreFromFile()">Restore Selected Backup</button>
</section>

<section class="card">
  <h2 class="section-title">Admin / Server Logs</h2>
  <div class="grid3">
    <button type="button" data-admin-action class="gray" onclick="loadLogs('admin')">Load Admin Activity</button>
    <button type="button" data-admin-action class="red" onclick="loadLogs('errors')">Load Server Errors</button>
    <button type="button" data-admin-action class="orange" onclick="clearServerErrors()">Clear Error Messages</button>
  </div>
  <div id="logBox" class="log-box">Log မဖွင့်ရသေးပါ</div>
</section>

<div id="rounds"></div>
</main>
<script>
var TURNSTILE_SITE_KEY=__SITE_KEY__;
var ADMIN_TIMES=["09:00 AM","11:00 AM","01:00 PM","03:00 PM","05:00 PM","07:00 PM"];
var adminState=null,widgetId=null,tokenPromise=null,tokenTimer=null,requestRunning=false;
var ADMIN_PASSWORD_SESSION_KEY="nz2d_admin_password_session";

function el(id){return document.getElementById(id)}
function message(text){el("message").textContent=text||""}
function esc(value){return String(value??"").replace(/[&<>"']/g,function(char){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]})}
function todayYangon(){
  var parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  var values={};parts.forEach(function(part){values[part.type]=part.value});
  return values.year+"-"+values.month+"-"+values.day;
}
function currentYangonMinute(){
  var parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Yangon",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  var values={};parts.forEach(function(part){values[part.type]=part.value});
  return Number(values.hour)*60+Number(values.minute);
}
function timeToMinutesClient(time){
  var match=String(time||"").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!match){return null}
  var hour=Number(match[1]),minute=Number(match[2]),period=match[3].toUpperCase();
  if(hour<1||hour>12||minute<0||minute>59){return null}
  if(hour===12){hour=0}if(period==="PM"){hour+=12}
  return hour*60+minute;
}
function makeRequestId(){
  return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
}
function setButtonsDisabled(disabled){
  document.querySelectorAll("[data-admin-action]").forEach(function(button){button.disabled=disabled});
}
function loadSavedAdminPassword(){
  try{
    var saved=sessionStorage.getItem(ADMIN_PASSWORD_SESSION_KEY);
    if(saved){el("adminPassword").value=saved;message("Admin password ကို ဒီ Tab အတွက် မှတ်ထားပါတယ်")}
  }catch(error){console.error(error)}
}
function rememberAdminPassword(){
  var password=el("adminPassword").value.trim();
  if(password){try{sessionStorage.setItem(ADMIN_PASSWORD_SESSION_KEY,password)}catch(error){console.error(error)}}
}
function forgetAdminPassword(){
  try{sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY)}catch(error){console.error(error)}
  el("adminPassword").value="";message("Admin Logout လုပ်ပြီး Password မှတ်ထားမှု ဖျက်ပြီးပါပြီ");
  el("adminPassword").focus();window.scrollTo({top:0,behavior:"smooth"});
}
function requirePassword(){
  if(!el("adminPassword").value.trim()){message("Admin password ထည့်ပါ");window.scrollTo({top:0,behavior:"smooth"});return false}
  return true;
}
function headers(requestId){
  return {"Content-Type":"application/json","X-Admin-Password":el("adminPassword").value.trim(),"X-Request-ID":requestId};
}
function waitForTurnstile(){
  return new Promise(function(resolve,reject){
    var count=0,timer=setInterval(function(){
      if(window.turnstile){clearInterval(timer);resolve();return}
      count++;if(count>=40){clearInterval(timer);reject(new Error("Human verification failed"))}
    },250);
  });
}
function initialiseTurnstile(){
  if(widgetId!==null){return}
  if(!TURNSTILE_SITE_KEY){throw new Error("TURNSTILE_SITE_KEY မရှိသေးပါ")}
  widgetId=window.turnstile.render("#turnstileContainer",{
    sitekey:TURNSTILE_SITE_KEY,action:"admin_action",execution:"execute",appearance:"interaction-only",
    callback:function(token){clearTimeout(tokenTimer);if(tokenPromise){tokenPromise.resolve(String(token||""))}tokenPromise=null},
    "error-callback":function(){clearTimeout(tokenTimer);if(tokenPromise){tokenPromise.reject(new Error("Human verification failed"))}tokenPromise=null;return true},
    "timeout-callback":function(){clearTimeout(tokenTimer);if(tokenPromise){tokenPromise.reject(new Error("Human verification failed"))}tokenPromise=null},
    "expired-callback":function(){clearTimeout(tokenTimer);if(tokenPromise){tokenPromise.reject(new Error("Human verification failed"))}tokenPromise=null}
  });
}
async function getToken(){
  await waitForTurnstile();initialiseTurnstile();
  return new Promise(function(resolve,reject){
    tokenPromise={resolve:resolve,reject:reject};
    tokenTimer=setTimeout(function(){tokenPromise=null;reject(new Error("Human verification failed"))},30000);
    window.turnstile.execute(widgetId);
  });
}
function resetTurnstile(){
  clearTimeout(tokenTimer);tokenPromise=null;
  if(window.turnstile&&widgetId!==null){window.turnstile.reset(widgetId)}
}
async function secureRequest(path,body,options){
  options=options||{};
  if(requestRunning){message("အရင် Request ပြီးအောင် ခဏစောင့်ပါ");return null}
  if(!requirePassword()){return null}
  requestRunning=true;setButtonsDisabled(true);message(options.loading||"Security စစ်ဆေးနေပါတယ်...");
  try{
    var token=await getToken();
    body=body||{};body.turnstileToken=token;
    var response=await fetch(path,{method:"POST",headers:headers(makeRequestId()),body:JSON.stringify(body)});
    var data=await response.json();
    if(response.status===401){
      sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY);el("adminPassword").value="";
      message("Admin password မှားနေပါတယ်။ ပြန်ထည့်ပါ။");return data;
    }
    if(!response.ok||!data.success){throw new Error(data.message||"မအောင်မြင်ပါ")}
    rememberAdminPassword();message(data.message||"အောင်မြင်ပါတယ်");
    if(options.reload!==false){await loadAdmin(false)}
    return data;
  }catch(error){message(error.message||"Request မအောင်မြင်ပါ");return null}
  finally{requestRunning=false;setButtonsDisabled(false);resetTurnstile()}
}
async function loadAdmin(renderForm){
  if(renderForm===undefined){renderForm=true}
  if(!requirePassword()){return}
  try{
    var response=await fetch("/api/admin/state?t="+Date.now(),{
      cache:"no-store",
      headers:{"X-Admin-Password":el("adminPassword").value.trim()}
    });
    adminState=await response.json();
    if(response.status===401){
      sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY);
      el("adminPassword").value="";
      throw new Error("Admin password မှားနေပါတယ်။ ပြန်ထည့်ပါ။");
    }
    if(!response.ok||!adminState.success){throw new Error(adminState.message||"Data ဖွင့်မရပါ")}
    rememberAdminPassword();
    el("baseSet").value=adminState.baseSet;el("baseValue").value=adminState.baseValue;el("liveResult").textContent=adminState.live.result;
    var paused=adminState.live.status==="paused";
    el("liveBadge").textContent=paused?"Paused":"Active";
    el("toggleButton").textContent=paused?"Resume Live Data":"Pause Live Data";
    el("toggleButton").className=paused?"green":"red";
    el("toggleButton").setAttribute("data-admin-action","");
    if(renderForm){renderRounds()}
    message("Admin Data ဖွင့်ပြီးပါပြီ");
  }catch(error){message(error.message||"DATA KV Binding ကို စစ်ပါ")}
}

function renderOldInputs(){
  el("oldHistoryInputs").innerHTML=ADMIN_TIMES.map(function(time,index){
    return '<div class="old-item"><div class="old-time">'+esc(time)+'</div>'+
      '<input id="oldResult'+index+'" class="old-input" inputmode="numeric" maxlength="2" placeholder="--"></div>';
  }).join("");
}
function renderHistoryRoundOptions(){
  el("historyEditRound").innerHTML=ADMIN_TIMES.map(function(time,index){
    return '<option value="'+(index+1)+'">Round '+(index+1)+' — '+esc(time)+'</option>';
  }).join("");
}
function clearOldInputs(){for(var index=0;index<6;index++){el("oldResult"+index).value=""}}
async function saveOldHistoryFromAdmin(){
  var date=el("oldHistoryDate").value;if(!date){message("History Date ရွေးပါ");return}
  var results=[];
  for(var index=0;index<6;index++){
    var value=el("oldResult"+index).value.replace(/\D/g,"").slice(0,2);
    if(!/^\d{2}$/.test(value)){message(ADMIN_TIMES[index]+" အတွက် 2D ဂဏန်း ၂ လုံးထည့်ပါ");return}
    results.push(value);
  }
  var data=await secureRequest("/api/admin/history/backfill",{date:date,results:results});
  if(data&&data.success){clearOldInputs()}
}
async function saveHistoryRecord(){
  var date=el("historyEditDate").value,round=Number(el("historyEditRound").value);
  var result=el("historyEditResult").value.replace(/\D/g,"").slice(0,2);
  if(!date||!/^\d{2}$/.test(result)){message("Date နှင့် 2D Result ၂ လုံး ထည့်ပါ");return}
  await secureRequest("/api/admin/history/upsert",{
    date:date,round:round,result:result,set:el("historyEditSet").value.trim(),value:el("historyEditValue").value.trim()
  });
}
async function deleteHistoryRecord(){
  var date=el("historyEditDate").value,round=Number(el("historyEditRound").value);
  if(!date){message("History Date ရွေးပါ");return}
  if(!confirm(date+" Round "+round+" History ကို ဖျက်မှာ သေချာပါသလား?")){return}
  await secureRequest("/api/admin/history/delete",{date:date,round:round});
}
function renderRounds(){
  el("rounds").innerHTML=adminState.rounds.map(function(round,index){
    var result=/^\d{2}$/.test(String(round.result||""))?esc(round.result):"--";
    var published=round.status==="published";
    return '<section class="card"><div class="head" onclick="el(\'editor'+index+'\').classList.toggle(\'open\')">'+
      '<div><b>Round '+round.round+'</b><div>'+esc(round.scheduleDate)+' · '+esc(round.time)+'</div></div>'+
      '<div class="big" style="font-size:34px">'+result+'</div></div>'+
      '<div id="editor'+index+'" class="editor"><div class="grid">'+
      '<div><label>Date</label><input id="date'+index+'" type="date" value="'+esc(round.scheduleDate)+'"></div>'+
      '<div><label>Time</label><input id="time'+index+'" value="'+esc(round.time)+'"></div>'+
      '<div><label>SET</label><input id="set'+index+'" inputmode="decimal" oninput="calculateRound('+index+')" value="'+esc(round.set)+'"></div>'+
      '<div><label>VALUE</label><input id="value'+index+'" inputmode="decimal" oninput="calculateRound('+index+')" value="'+esc(round.value)+'"></div></div>'+
      '<label>2D Result</label><input id="result'+index+'" readonly value="'+(round.result==="--"?"":esc(round.result))+'">'+
      '<label><input id="auto'+index+'" type="checkbox" style="width:auto" '+(round.autoPublish?"checked":"")+'> Auto publish</label>'+
      '<button type="button" data-admin-action onclick="saveRound('+index+',false)">Save Schedule</button>'+
      '<button type="button" data-admin-action class="green" onclick="publishRound('+index+')">Publish Now</button>'+
      (published?'<button type="button" data-admin-action class="red" onclick="unpublishRound('+index+')">Undo Publish</button>':'')+
      '</div></section>';
  }).join("");
}
function calculateRound(index){
  var setDigits=el("set"+index).value.replace(/,/g,"").replace(/\D/g,"");
  var valueDigits=el("value"+index).value.replace(/,/g,"").split(".")[0].replace(/\D/g,"");
  el("result"+index).value=setDigits&&valueDigits?setDigits.slice(-1)+valueDigits.slice(-1):"";
}
function validateRoundInputs(index){
  var pattern=/^[0-9]+\.[0-9]{2}$/;
  var setInput=el("set"+index),valueInput=el("value"+index);
  if(!pattern.test(setInput.value.trim())||Number(setInput.value)<=0){alert("SET ကို ဒဿမ ၂ လုံးပါသော မှန်ကန်သည့်ဂဏန်း ထည့်ပါ။");setInput.focus();return false}
  if(!pattern.test(valueInput.value.trim())||Number(valueInput.value)<=0){alert("VALUE ကို ဒဿမ ၂ လုံးပါသော မှန်ကန်သည့်ဂဏန်း ထည့်ပါ။");valueInput.focus();return false}
  calculateRound(index);
  if(!/^\d{2}$/.test(el("result"+index).value)){alert("2D Result တွက်ချက်၍မရပါ");return false}
  return true;
}
function publishRound(index){
  if(!validateRoundInputs(index)){return}
  var date=el("date"+index).value,time=el("time"+index).value;
  var target=timeToMinutesClient(time);
  if(date>todayYangon()||(date===todayYangon()&&target!==null&&target>currentYangonMinute())){
    alert("သတ်မှတ်ချိန် မရောက်သေးသော Round ကို ထုတ်လို့မရပါ");return;
  }
  if(confirm("Publish this result now?")){saveRound(index,true)}
}
function saveRound(index,publishNow){
  if(!validateRoundInputs(index)){return}
  secureRequest("/api/admin/round/"+(index+1),{
    scheduleDate:el("date"+index).value,time:el("time"+index).value,set:el("set"+index).value,
    value:el("value"+index).value,result:el("result"+index).value,autoPublish:el("auto"+index).checked,publishNow:Boolean(publishNow)
  });
}
async function unpublishRound(index){
  if(!confirm("Round "+(index+1)+" Publish ကို ပြန်ဖြုတ်မှာ သေချာပါသလား?")){return}
  await secureRequest("/api/admin/round/"+(index+1)+"/unpublish",{});
}
function saveBaseValues(){
  var pattern=/^[0-9]+\.[0-9]{2}$/;
  if(!pattern.test(el("baseSet").value.trim())||Number(el("baseSet").value)<=0){message("Base SET ကို ဒဿမ ၂ လုံးဖြင့်ထည့်ပါ");return}
  if(!pattern.test(el("baseValue").value.trim())||Number(el("baseValue").value)<=0){message("Base VALUE ကို ဒဿမ ၂ လုံးဖြင့်ထည့်ပါ");return}
  secureRequest("/api/admin/base",{baseSet:el("baseSet").value,baseValue:el("baseValue").value});
}
function toggleLive(){secureRequest("/api/admin/toggle",{})}
async function downloadFullBackup(){
  if(requestRunning){message("အရင် Request ပြီးအောင် ခဏစောင့်ပါ");return}
  if(!requirePassword()){return}
  requestRunning=true;setButtonsDisabled(true);message("Backup File ပြင်ဆင်နေပါတယ်...");
  try{
    var token=await getToken();
    var response=await fetch("/api/admin/backup/export",{
      method:"POST",headers:headers(makeRequestId()),body:JSON.stringify({turnstileToken:token})
    });
    if(!response.ok){
      var errorData={};try{errorData=await response.json()}catch(error){}
      if(response.status===401){sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY);el("adminPassword").value=""}
      throw new Error(errorData.message||"Backup Download မအောင်မြင်ပါ");
    }
    var blob=await response.blob(),disposition=response.headers.get("Content-Disposition")||"";
    var match=disposition.match(/filename="?([^"]+)"?/i);
    var fileName=match&&match[1]?match[1]:"nz2d-full-backup.json";
    var downloadUrl=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=downloadUrl;link.download=fileName;document.body.appendChild(link);link.click();link.remove();
    setTimeout(function(){URL.revokeObjectURL(downloadUrl)},1000);
    rememberAdminPassword();message("Full Backup JSON File Download ပြီးပါပြီ");
  }catch(error){message(error.message||"Backup Download မအောင်မြင်ပါ")}
  finally{requestRunning=false;setButtonsDisabled(false);resetTurnstile()}
}
async function restoreFromFile(){
  var file=el("restoreFile").files[0],mode=el("restoreMode").value;
  if(!file){message("Restore JSON File ရွေးပါ");return}
  if(file.size>2*1024*1024){message("Restore File Size 2 MB ထက်ကျော်နေပါတယ်");return}
  if(!confirm("Restore လုပ်မည်။ လက်ရှိ Data ကို Safety Backup အရင်သိမ်းပါမယ်။ ဆက်လုပ်မလား?")){return}
  if((mode==="full_replace"||mode==="history_replace")&&!confirm("Replace Mode ဖြစ်ပါတယ်။ တကယ်ဆက်လုပ်မှာ သေချာပါသလား?")){return}
  try{
    var text=await file.text(),backup=JSON.parse(text);
    var data=await secureRequest("/api/admin/backup/restore",{mode:mode,backup:backup},{loading:"Backup Restore လုပ်နေပါတယ်..."});
    if(data&&data.success){el("restoreFile").value=""}
  }catch(error){message("JSON File ဖတ်မရပါ: "+error.message)}
}
async function loadLogs(type){
  var path=type==="errors"?"/api/admin/errors":"/api/admin/logs";
  var data=await secureRequest(path,{limit:50},{reload:false,loading:"Logs ဖွင့်နေပါတယ်..."});
  if(data&&data.success){el("logBox").textContent=JSON.stringify(data.items,null,2)}
}
async function clearServerErrors(){
  if(!confirm("Server Error စာများအားလုံးကို ဖျက်မလား?")){return}
  var data=await secureRequest(
    "/api/admin/errors/clear",
    {},
    {reload:false,loading:"Server Error စာများဖျက်နေပါတယ်..."}
  );
  if(data&&data.success){el("logBox").textContent="Server Error မရှိပါ"}
}
loadSavedAdminPassword();
el("oldHistoryDate").value=todayYangon();
el("historyEditDate").value=todayYangon();
renderOldInputs();renderHistoryRoundOptions();
if(el("adminPassword").value.trim()){loadAdmin()}
else{message("Admin password ထည့်ပြီး Open Admin / Load Data ကိုနှိပ်ပါ")}
</script>
</body>
</html>`;

  return page.replace("__SITE_KEY__", JSON.stringify(siteKey || ""));
}

async function handleAdminRoute(request, env, url) {
  const body = await readJsonBody(request);
  const denied = await protectAdmin(request, env, body);
  if (denied) {
    return denied;
  }

  if (url.pathname === "/api/admin/backup/export") {
    const backup = await buildFullBackup(env);
    await logAdminAction(env, request, "backup_export", {
      historyDates: Object.keys(backup.history).length
    });

    return new Response(backupToJsonText(backup), {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "application/json;charset=UTF-8",
        "Content-Disposition":
          'attachment; filename="nz2d-full-backup-' +
          safeBackupTimestamp() +
          '.json"',
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });
  }

  if (url.pathname === "/api/admin/backup/restore") {
    const result = await restoreBackup(
      env,
      body.backup,
      String(body.mode || "")
    );

    await logAdminAction(env, request, "backup_restore", result);

    return jsonResponse({
      success: true,
      message: "Backup Restore အောင်မြင်ပါတယ်",
      ...result
    });
  }

  if (url.pathname === "/api/admin/logs") {
    return jsonResponse({
      success: true,
      message: "Admin Logs ဖွင့်ပြီးပါပြီ",
      items: await listRecentLogs(env, ADMIN_LOG_PREFIX, body.limit)
    });
  }

  if (url.pathname === "/api/admin/errors") {
    return jsonResponse({
      success: true,
      message: "Server Error Logs ဖွင့်ပြီးပါပြီ",
      items: await listRecentLogs(env, ERROR_LOG_PREFIX, body.limit)
    });
  }

  if (url.pathname === "/api/admin/errors/clear") {
    const deleted = await deleteKeysWithPrefix(env, ERROR_LOG_PREFIX);
    await logAdminAction(env, request, "server_error_logs_cleared", { deleted });

    return jsonResponse({
      success: true,
      message: "Server Error စာများဖျက်ပြီးပါပြီ",
      deleted
    });
  }

  if (url.pathname === "/api/admin/base") {
    const state = await getState(env);
    state.live.baseSet = strictMarketNumber(body.baseSet, "Base SET");
    state.live.baseValue = strictMarketNumber(body.baseValue, "Base VALUE");
    state.live.override = null;
    await saveState(env, state);

    await logAdminAction(env, request, "base_values_saved", {
      baseSet: state.live.baseSet,
      baseValue: state.live.baseValue
    });

    return jsonResponse({
      success: true,
      message: "Base values သိမ်းပြီးပါပြီ"
    });
  }

  if (url.pathname === "/api/admin/toggle") {
    const state = await getState(env);

    if (state.live.status === "active") {
      const current = getLiveData(state.live);
      state.live.status = "paused";
      state.live.frozen = {
        set: current.set,
        value: current.value,
        result: current.result,
        updatedAt: yangonNowText()
      };
    } else {
      state.live.status = "active";
      state.live.frozen = null;
    }

    await saveState(env, state);
    await logAdminAction(env, request, "live_toggled", {
      status: state.live.status
    });

    return jsonResponse({
      success: true,
      message:
        state.live.status === "active"
          ? "Live Data ပြန်ဖွင့်ပြီးပါပြီ"
          : "Live Data ခဏရပ်ထားပါတယ်"
    });
  }

  if (url.pathname === "/api/admin/history/backfill") {
    const date = String(body.date || "");
    if (!isRealDate(date)) {
      throw new HttpError(400, "History Date မှားနေပါတယ်");
    }
    if (!Array.isArray(body.results) || body.results.length !== 6) {
      throw new HttpError(400, "2D ဂဏန်း ၆ ခုလုံးထည့်ပါ");
    }

    const items = body.results.map((value, index) => ({
      date,
      round: index + 1,
      time: TIMES[index],
      result: requireResult(value, TIMES[index] + " Result"),
      set: "",
      value: "",
      publishedAt: "Old History",
      publishedAtMs: 0
    }));

    await putHistory(env, date, items);
    await logAdminAction(env, request, "history_backfill", { date });

    return jsonResponse({
      success: true,
      message: date + " အတွက် 2D ဂဏန်း ၆ ခု သိမ်းပြီးပါပြီ",
      items
    });
  }

  if (url.pathname === "/api/admin/history/upsert") {
    const date = String(body.date || "");
    const roundNumber = Number(body.round);

    if (!isRealDate(date)) {
      throw new HttpError(400, "History Date မှားနေပါတယ်");
    }
    if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 6) {
      throw new HttpError(400, "History Round မှားနေပါတယ်");
    }

    const result = requireResult(body.result);
    const setText = String(body.set ?? "").trim();
    const valueText = String(body.value ?? "").trim();
    const bothEmpty = setText === "" && valueText === "";

    let set = "";
    let value = "";
    let publishedAt = "Old History";
    let publishedAtMs = 0;

    if (!bothEmpty) {
      if (!setText || !valueText) {
        throw new HttpError(
          400,
          "SET နှင့် VALUE နှစ်ခုလုံးထည့်ပါ၊ မဟုတ်ရင် နှစ်ခုလုံးအလွတ်ထားပါ"
        );
      }
      set = strictMarketNumber(setText, "History SET");
      value = strictMarketNumber(valueText, "History VALUE");

      const expectedResult = calculate2D(set, value);
      if (result !== expectedResult) {
        throw new HttpError(
          400,
          "History 2D Result သည် SET / VALUE နှင့် မကိုက်ပါ။ Expected: " +
            expectedResult
        );
      }

      publishedAt = yangonNowText();
      publishedAtMs = Date.now();
    }

    const item = {
      date,
      round: roundNumber,
      time: TIMES[roundNumber - 1],
      result,
      set,
      value,
      publishedAt,
      publishedAtMs
    };

    await addHistory(env, item);
    await logAdminAction(env, request, "history_upsert", {
      date,
      round: roundNumber,
      result
    });

    return jsonResponse({
      success: true,
      message: date + " Round " + roundNumber + " History သိမ်းပြီးပါပြီ",
      item
    });
  }

  if (url.pathname === "/api/admin/history/delete") {
    const date = String(body.date || "");
    const roundNumber = Number(body.round);

    if (!isRealDate(date)) {
      throw new HttpError(400, "History Date မှားနေပါတယ်");
    }
    if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 6) {
      throw new HttpError(400, "History Round မှားနေပါတယ်");
    }

    const items = await deleteHistoryRound(env, date, roundNumber);
    await logAdminAction(env, request, "history_delete", {
      date,
      round: roundNumber
    });

    return jsonResponse({
      success: true,
      message: date + " Round " + roundNumber + " History ဖျက်ပြီးပါပြီ",
      items
    });
  }

  const unpublishMatch = url.pathname.match(
    /^\/api\/admin\/round\/([1-6])\/unpublish$/
  );

  if (unpublishMatch) {
    const roundNumber = Number(unpublishMatch[1]);
    const lock = await acquireRoundLock(env, roundNumber);

    if (!lock) {
      throw new HttpError(409, "ဒီ Round ကို အခြားလုပ်ဆောင်ချက်တစ်ခု ပြုလုပ်နေပါတယ်။ ခဏနောက် ပြန်စမ်းပါ");
    }

    try {
      const state = await getState(env);
      const round = state.rounds[roundNumber - 1];

      if (round.status !== "published") {
        throw new HttpError(400, "ဒီ Round က Published မဖြစ်သေးပါ");
      }

      await deleteHistoryRound(env, round.scheduleDate, roundNumber);

      const overrideMatches =
        state.live.override &&
        state.live.override.result === round.result &&
        state.live.override.updatedAt === round.publishedAt;

      state.rounds[roundNumber - 1] = {
        ...round,
        status: "waiting",
        autoPublish: false,
        publishedAt: "",
        publishedAtMs: 0
      };

      if (overrideMatches) {
        state.live.override = null;
      }

      await saveState(env, state);
      await cancelRoundAlarm(env, roundNumber);
      await logAdminAction(env, request, "round_unpublished", {
        date: round.scheduleDate,
        round: roundNumber,
        result: round.result
      });

      return jsonResponse({
        success: true,
        message: "Round " + roundNumber + " Publish ပြန်ဖြုတ်ပြီးပါပြီ"
      });
    } finally {
      await releaseRoundLock(env, lock);
    }
  }

  const roundMatch = url.pathname.match(/^\/api\/admin\/round\/([1-6])$/);

  if (roundMatch) {
    const roundNumber = Number(roundMatch[1]);
    const scheduleDate = String(body.scheduleDate || "");
    const time = String(body.time || "").trim();

    if (!isRealDate(scheduleDate)) {
      throw new HttpError(400, "Schedule Date မှားနေပါတယ်");
    }
    if (timeToMinutes(time) === null) {
      throw new HttpError(
        400,
        "Time format ကို 09:00 AM ပုံစံဖြင့်ထည့်ပါ"
      );
    }

    const set = strictMarketNumber(body.set, "SET");
    const value = strictMarketNumber(body.value, "VALUE");
    const result = calculate2D(set, value);
    const publishNow = Boolean(body.publishNow);

    if (publishNow && compareScheduleToNow(scheduleDate, time) === 1) {
      throw new HttpError(
        400,
        "သတ်မှတ်ချိန် မရောက်သေးသော Round ကို ထုတ်လို့မရပါ"
      );
    }

    const lock = await acquireRoundLock(env, roundNumber);
    if (!lock) {
      throw new HttpError(409, "ဒီ Round ကို အခြားလုပ်ဆောင်ချက်တစ်ခု ပြုလုပ်နေပါတယ်။ ခဏနောက် ပြန်စမ်းပါ");
    }

    try {
      const state = await getState(env);
      const currentRound = state.rounds[roundNumber - 1];

      if (currentRound.status === "published") {
        throw new HttpError(
          400,
          "Published Round ကို ပြင်ရန် Undo Publish အရင်လုပ်ပါ"
        );
      }

      const publishedAtMs = publishNow ? Date.now() : 0;
      const round = {
        round: roundNumber,
        time,
        scheduleDate,
        set,
        value,
        result,
        status: publishNow ? "published" : "waiting",
        autoPublish: Boolean(body.autoPublish),
        publishedAt: publishNow ? yangonNowText() : "",
        publishedAtMs
      };

      state.rounds[roundNumber - 1] = round;

      if (publishNow) {
        state.live.override = {
          set,
          value,
          result,
          updatedAt: round.publishedAt,
          until: publishedAtMs + OVERRIDE_MS
        };

        await addHistory(env, {
          date: scheduleDate,
          round: roundNumber,
          time,
          set,
          value,
          result,
          publishedAt: round.publishedAt,
          publishedAtMs
        });
      }

      await saveState(env, state);
      await syncRoundAlarm(env, round);
      await logAdminAction(
        env,
        request,
        publishNow ? "round_published" : "round_schedule_saved",
        {
          date: scheduleDate,
          round: roundNumber,
          time,
          result,
          autoPublish: round.autoPublish
        }
      );

      return jsonResponse({
        success: true,
        message: publishNow
          ? "Round " + roundNumber + " ထုတ်ပြီးပါပြီ"
          : "Round " + roundNumber + " Schedule သိမ်းပြီးပါပြီ"
      });
    } finally {
      await releaseRoundLock(env, lock);
    }
  }

  throw new HttpError(404, "Admin API မတွေ့ပါ");
}

async function handleRequest(request, env) {
  const url = new URL(request.url);

  try {
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/app")) {
      return htmlResponse(appPage());
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      return htmlResponse(
        adminPage(String(env.TURNSTILE_SITE_KEY || "")),
        { "X-Robots-Tag": "noindex, nofollow" }
      );
    }

    if (request.method === "GET" && url.pathname === "/history") {
      return htmlResponse(historyPage());
    }

    if (request.method === "GET" && url.pathname === "/api/admin/state") {
      const denied = await protectAdminRead(request, env);
      if (denied) {
        return denied;
      }

      const state = await getState(env);
      const live = getLiveData(state.live);

      return jsonResponse({
        success: true,
        serverNow: Date.now(),
        date: state.date,
        live,
        appStatus: getPublicStatus(state, live),
        rounds: state.rounds,
        baseSet: state.live.baseSet,
        baseValue: state.live.baseValue
      });
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      // The public page calls this endpoint exactly at the round boundary.
      // Publishing due rounds here avoids Durable Object alarm delivery delays
      // and makes the final result appear at the configured minute.
      const state = await autoPublish(env, "state_boundary_publish");
      const live = getLiveData(state.live);
      const nextAutoPublishAtMs = getNextAutoPublishAtMs(state);

      return jsonResponse({
        success: true,
        serverNow: Date.now(),
        date: state.date,
        live,
        appStatus: getPublicStatus(state, live),
        rounds: state.rounds.map(publicRound),
        nextAutoPublishAtMs,
        preSpinPool: getPreSpinPool(state, nextAutoPublishAtMs),
        preSpinFrames: getPreSpinFrames(state, nextAutoPublishAtMs)
      });
    }

    if (request.method === "GET" && url.pathname === "/api/history") {
      const date = url.searchParams.get("date") || yangonDate();
      if (!isRealDate(date)) {
        throw new HttpError(400, "Date format မှားနေပါတယ်");
      }

      const requestedDays = Number(url.searchParams.get("days") || 1);
      const days = Math.min(
        120,
        Math.max(1, Number.isFinite(requestedDays) ? Math.trunc(requestedDays) : 1)
      );

      if (days === 1) {
        return jsonResponse({
          success: true,
          date,
          items: await getHistory(env, date)
        });
      }

      const dates = Array.from(
        { length: days },
        (_, index) => shiftDateText(date, -index)
      );
      const records = await Promise.all(
        dates.map(async selectedDate => ({
          date: selectedDate,
          items: await getHistory(env, selectedDate)
        }))
      );

      return jsonResponse({
        success: true,
        date,
        days,
        records
      });
    }

    if (
      request.method === "POST" &&
      url.pathname.startsWith("/api/admin/")
    ) {
      return await handleAdminRoute(request, env, url);
    }

    return jsonResponse(
      { success: false, message: "Not found" },
      404
    );
  } catch (error) {
    const status =
      error instanceof HttpError && Number.isInteger(error.status)
        ? error.status
        : 500;

    if (status >= 500) {
      await logServerError(env, error, request);
    }

    return jsonResponse(
      {
        success: false,
        message:
          status >= 500
            ? "Server error ဖြစ်နေပါတယ်။ Error Log ကို စစ်ပါ။"
            : String(error.message || "Request မအောင်မြင်ပါ")
      },
      status
    );
  }
}

async function scheduledMaintenance(env) {
  await autoPublish(env);
  await createDailyBackup(env);
}

export default {
  fetch: handleRequest,

  scheduled(event, env, context) {
    context.waitUntil(
      scheduledMaintenance(env).catch(error =>
        logServerError(env, error, null, {
          source: "scheduled",
          cron: event.cron
        })
      )
    );
  }
};
