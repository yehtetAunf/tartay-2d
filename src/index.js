import { DurableObject } from "cloudflare:workers";

const DATA_KEY = "tartay_8_times_2d_state_v1";

const TIMES = [
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
  "08:00 PM",
  "09:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM"
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
    Array.isArray(state.rounds) && state.rounds.length === 8
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
    rounds: rounds.slice(0, 8).map((round, index) => ({
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
    .slice(0, 8)
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
    appName: "New Zealand 2D",
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

  if (!Array.isArray(state.rounds) || state.rounds.length !== 8) {
    restoreValidationError("Round ၈ ခု မပြည့်ပါ");
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
    if (items.length > 8) {
      restoreValidationError(
        historyDate + " History Round ၈ ခုထက်ကျော်နေပါတယ်"
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
        roundNumber > 8
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
  return `<!doctype html>
<html lang="my">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#111a2d">
<title>တာတေ 2D</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;width:100%;min-height:100%;font-family:Arial,"Noto Sans Myanmar",sans-serif;background:#10192c;color:#fff}
body{min-height:100dvh;overflow-x:hidden}
.motion-bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:#10192c url("/tartay-couple.png") center/cover no-repeat}
.motion-bg video{width:100%;height:100%;object-fit:cover;object-position:center;filter:brightness(.17) saturate(.65)}
.motion-bg:after{content:"";position:absolute;inset:0;background:rgba(10,19,37,.84)}
.page{position:relative;z-index:1;width:100%;max-width:760px;min-height:100dvh;margin:0 auto;padding:14px 14px calc(18px + env(safe-area-inset-bottom))}
.topbar{height:70px;display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:10px;margin-bottom:6px}
.back-btn{width:48px;height:48px;border:0;border-radius:12px;background:rgba(27,39,65,.94);color:#fff;font-size:38px;line-height:1;display:grid;place-items:center;cursor:pointer}
.brand{font-size:34px;font-weight:900;white-space:nowrap;letter-spacing:-.8px}.brand b{color:#ffc400}
.top-history{height:48px;padding:0 14px;border-radius:12px;background:rgba(27,39,65,.94);display:flex;align-items:center;gap:7px;color:#ffc400;text-decoration:none;font-size:19px;font-weight:800;white-space:nowrap}
.hero{position:relative;text-align:center;padding:8px 0 13px}
.status{position:absolute;right:2px;top:2px;display:flex;align-items:center;gap:6px;border:1.5px solid #32d97a;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:800;background:rgba(9,25,26,.5)}
.status-dot{width:8px;height:8px;border-radius:50%;background:#54e895;box-shadow:0 0 8px #54e895}.status.offline{border-color:#e85c70}.status.offline .status-dot{background:#e85c70;box-shadow:none}
.big{height:185px;display:flex;align-items:center;justify-content:center;color:#ffc000;font-size:126px;font-weight:900;line-height:1;text-shadow:0 4px 10px rgba(0,0,0,.24)}
.updated{display:flex;justify-content:center;align-items:center;gap:8px;font-size:16px;font-weight:800;margin:0 0 17px;color:#f6f7fb;text-shadow:0 1px 3px #000}
.round-list{display:flex;flex-direction:column;gap:9px}
.result-card{overflow:hidden;border-radius:13px;background:#f7f7f8;box-shadow:0 2px 8px rgba(0,0,0,.28)}
.result-head,.result-body{display:grid;grid-template-columns:1.08fr 1fr 1.25fr .72fr;text-align:center;align-items:center}
.result-head{height:29px;background:#020202;color:#b9b9bb;font-size:14px;font-weight:800}
.result-body{height:62px;background:#fafafa;color:#0e1728;font-weight:900}
.result-body>div{min-width:0;padding:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell-time{font-size:19px}.cell-set,.cell-value{font-size:17px}.cell-2d{height:54px;margin:4px;border-radius:11px;background:#eeeeef;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:900}
@media(max-width:520px){
 .page{padding:8px 10px calc(12px + env(safe-area-inset-bottom))}.topbar{height:58px;grid-template-columns:44px 1fr auto;gap:7px}.back-btn{width:42px;height:42px;font-size:33px;border-radius:10px}.brand{font-size:28px}.top-history{height:42px;padding:0 10px;font-size:16px;border-radius:10px}
 .hero{padding-top:2px}.status{top:0}.big{height:137px;font-size:92px}.updated{font-size:13px;margin-bottom:10px}
 .round-list{gap:7px}.result-head{height:23px;font-size:11px}.result-body{height:50px}.cell-time{font-size:15px}.cell-set,.cell-value{font-size:13px}.cell-2d{height:44px;margin:3px;font-size:29px;border-radius:9px}
}
@media(max-width:380px){.brand{font-size:25px}.top-history{font-size:14px;padding:0 8px}.big{height:122px;font-size:84px}.result-head,.result-body{grid-template-columns:1.08fr .94fr 1.24fr .74fr}.cell-time{font-size:14px}.cell-set,.cell-value{font-size:12px}.cell-2d{font-size:27px}}
</style>
</head>
<body>
<div class="motion-bg" aria-hidden="true"><video autoplay muted loop playsinline poster="/tartay-couple.png"><source src="/tartay-couple.mp4" type="video/mp4"></video></div>
<div class="page">
  <header class="topbar">
    <button class="back-btn" type="button" onclick="history.back()">‹</button>
    <div class="brand">တာတေ <b>2D</b></div>
    <a class="top-history" href="/history"><span>▣</span><span>History</span></a>
  </header>
  <section class="hero">
    <div id="statusBadge" class="status"><span class="status-dot"></span><span id="statusText">LIVE</span></div>
    <div id="bigResult" class="big">--</div>
    <div class="updated">◷ <span>Updated =</span> <span id="updatedText">Waiting for result</span></div>
  </section>
  <section id="roundGrid" class="round-list"></section>
</div>
<script>
(function(){
  var TIMES=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
  function esc(v){return String(v==null?"--":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function formatUpdated(value){if(!value)return "Waiting for result";var d=new Date(value);if(Number.isNaN(d.getTime()))return String(value);return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Yangon",year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).format(d)}
  function normalizeTime(t){return String(t||"").trim().toUpperCase().replace(/^([1-9]):/,"0$1:")}
  function renderRounds(rounds){
    var safe=Array.isArray(rounds)?rounds:[];
    var map={};safe.forEach(function(r,i){map[normalizeTime(r.time||r.result_time||TIMES[i])]=r||{}});
    document.getElementById("roundGrid").innerHTML=TIMES.map(function(t,i){
      var r=map[t]||safe[i]||{};
      var result=String(r.result||r.result_number||"");
      var published=(r.status==="published"||r.publishedAt||r.published_at)&&/^\d{2}$/.test(result);
      var set=published?(r.set||r.set_value||"--"):"--";
      var value=published?(r.value||r.value_value||"--"):"--";
      var num=published?result:"--";
      return '<article class="result-card"><div class="result-head"><div>Time</div><div>Set</div><div>Value</div><div>2D</div></div><div class="result-body"><div class="cell-time">'+esc(t)+'</div><div class="cell-set">'+esc(set)+'</div><div class="cell-value">'+esc(value)+'</div><div class="cell-2d">'+esc(num)+'</div></div></article>';
    }).join("");
  }
  function setStatus(status){var badge=document.getElementById("statusBadge"),txt=document.getElementById("statusText");var offline=status&&status.code==="offline";badge.classList.toggle("offline",offline);txt.textContent=offline?"OFFLINE":((status&&status.label)||"LIVE")}
  function latestRound(rounds){var p=(Array.isArray(rounds)?rounds:[]).filter(function(r){return r&&(r.status==="published"||r.publishedAt||r.published_at)&&/^\d{2}$/.test(String(r.result||r.result_number||""))});p.sort(function(a,b){return Number(b.publishedAtMs||b.published_at_ms||0)-Number(a.publishedAtMs||a.published_at_ms||0)});return p[0]||null}
  async function load(){try{
    var res=await fetch("/api/state?t="+Date.now(),{cache:"no-store"}),data=await res.json();if(!res.ok||!data.success)throw new Error("Load failed");
    setStatus(data.appStatus||{label:"LIVE"});var live=data.live||{},latest=latestRound(data.rounds);
    var liveResult=String(live.result||live.result_number||"");var livePublished=(live.status==="published"||live.publishedAt||live.published_at)&&/^\d{2}$/.test(liveResult);
    document.getElementById("bigResult").textContent=livePublished?liveResult:(latest?String(latest.result||latest.result_number):"--");
    document.getElementById("updatedText").textContent=livePublished?formatUpdated(live.updatedAt||live.updated_at||live.publishedAt||live.published_at):(latest?formatUpdated(latest.updatedAt||latest.updated_at||latest.publishedAt||latest.published_at):"Waiting for result");
    renderRounds(data.rounds);
  }catch(e){setStatus({code:"offline"});document.getElementById("bigResult").textContent="--";document.getElementById("updatedText").textContent="Waiting for result";renderRounds([])}}
  renderRounds([]);load();setInterval(load,10000);
})();
</script>
</body>
</html>`;
}

function historyPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#051a3f">
<title>2D History</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,sans-serif;background:#061d43;color:white}body{background:#061d43}.history-bg{position:fixed;inset:0;z-index:0;overflow:hidden;background:#061d43 url("/tartay-couple.png") center/cover no-repeat}.history-bg video{width:100%;height:100%;object-fit:cover;object-position:center;filter:brightness(.30) saturate(.78)}.history-bg:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(2,15,42,.48),rgba(2,15,42,.66) 48%,rgba(2,15,42,.82))}button,input{font:inherit}.page{position:relative;z-index:1;width:100%;max-width:1180px;margin:0 auto;padding:28px 38px 36px}.header{display:grid;grid-template-columns:96px 1fr 96px;align-items:center}.back,.calendar-btn{width:92px;height:92px;border-radius:50%;display:grid;place-items:center;background:rgba(3,24,58,.78);border:3px solid #14508e;color:#fff;text-decoration:none;font-size:58px;box-shadow:0 0 18px rgba(0,187,255,.08)}.calendar-btn{justify-self:end;border-color:#19c8ff;box-shadow:0 0 18px rgba(0,205,255,.45);font-size:43px;cursor:pointer}.header h1{text-align:center;font-size:70px;margin:0;font-weight:700}.datebar{margin-top:45px;height:145px;border-radius:38px;background:linear-gradient(135deg,#0964cf,#0758c3);display:flex;align-items:center;padding:0 45px;gap:28px;box-shadow:inset 0 0 30px rgba(0,177,255,.2)}.date-icon{width:104px;height:104px;border-radius:22px;background:rgba(25,113,224,.6);display:grid;place-items:center;font-size:55px}.date-text{font-size:64px;font-weight:700;letter-spacing:2px}.picker{position:absolute;opacity:0;pointer-events:none}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:55px 48px;margin:44px 50px 0}.slot{text-align:center}.slot-time{min-height:98px;font-size:42px;font-weight:700;line-height:1.16;display:flex;align-items:flex-start;justify-content:center}.result{height:205px;border-radius:31px;border:3px solid #149fff;background:linear-gradient(145deg,#1766c8,#0b3e9d 70%,#082c76);display:grid;place-items:center;font-size:58px;font-weight:900;box-shadow:0 0 18px rgba(0,205,255,.5),inset 0 0 28px rgba(39,160,255,.35)}.note{margin:62px 5px 0;min-height:95px;border-radius:48px;background:rgba(8,56,111,.58);display:flex;align-items:center;justify-content:center;gap:28px;font-size:34px;padding:20px 35px}.shield{font-size:50px}.message{text-align:center;color:#a9c7ef;font-size:20px;margin-top:20px}
@media(max-width:600px){.page{max-width:none;padding:18px 12px 26px}.header{grid-template-columns:54px 1fr 54px}.back,.calendar-btn{width:52px;height:52px;border-width:2px;font-size:34px}.calendar-btn{font-size:26px}.header h1{font-size:36px}.datebar{margin-top:22px;height:78px;border-radius:22px;padding:0 18px;gap:14px}.date-icon{width:54px;height:54px;border-radius:14px;font-size:30px}.date-text{font-size:32px}.grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:22px 10px;margin:24px 0 0}.slot-time{min-height:48px;font-size:20px}.result{height:92px;border-radius:18px;border-width:2px;font-size:30px}.note{margin:28px 0 0;min-height:62px;border-radius:30px;gap:12px;font-size:16px;padding:12px 14px}.shield{font-size:28px}.message{font-size:15px;margin-top:12px}}
@media(max-width:380px){.page{padding-left:8px;padding-right:8px}.header h1{font-size:32px}.date-text{font-size:28px}.grid{gap-left:8px}.slot-time{font-size:18px}.result{height:84px;font-size:28px}}
@media(max-width:700px){.page{padding:20px 16px 28px}.header{grid-template-columns:62px 1fr 62px}.back,.calendar-btn{width:58px;height:58px;font-size:36px;border-width:2px}.calendar-btn{font-size:28px}.header h1{font-size:42px}.datebar{margin-top:30px;height:88px;border-radius:24px;padding:0 20px;gap:16px}.date-icon{width:62px;height:62px;border-radius:15px;font-size:34px}.date-text{font-size:36px}.grid{margin:28px 7px 0;grid-template-columns:repeat(4,1fr);gap:28px 14px}.slot-time{min-height:62px;font-size:23px}.result{height:118px;border-radius:20px;font-size:34px;border-width:2px}.note{margin-top:38px;min-height:72px;border-radius:35px;font-size:20px;gap:14px;padding:14px}.shield{font-size:32px}}
@media(max-width:390px){.header h1{font-size:36px}.date-text{font-size:31px}.grid{gap:24px 9px;margin-left:0;margin-right:0}.slot-time{font-size:20px}.result{height:108px;font-size:31px}.note{font-size:17px}}
</style>
</head>
<body>
<div class="history-bg" aria-hidden="true"><video autoplay muted loop playsinline poster="/tartay-couple.png"><source src="/tartay-couple.mp4" type="video/mp4"></video></div>
<div class="page">
  <header class="header">
    <a class="back" href="/app" aria-label="Back">‹</a>
    <h1>2D History</h1>
    <button id="calendarBtn" class="calendar-btn" type="button" aria-label="Choose date">▣</button>
  </header>
  <div class="datebar"><div class="date-icon">▣</div><div id="dateText" class="date-text">----</div></div>
  <input id="historyDate" class="picker" type="date">
  <div id="historyGrid" class="grid"></div>
  <div class="note"><span class="shield">🛡️</span><span>Results are final and will be held for 2 minutes.</span></div>
  <div id="message" class="message"></div>
</div>
<script>
(function(){
  var TIMES=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
  function todayYangon(){var p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yangon',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),o={};p.forEach(function(x){o[x.type]=x.value});return o.year+'-'+o.month+'-'+o.day}
  function fmtDate(d){var x=String(d||'').split('-');return x.length===3?x[0]+'/'+x[1]+'/'+x[2]:'----'}
  function splitTime(t){var m=String(t).match(/^(\\d{2}:\\d{2})\\s+(AM|PM)$/);return m?m[1]+'<br>'+m[2]:t}
  function resultForRound(items,n){var a=Array.isArray(items)?items:[];var r=a.find(function(x){return Number(x.round)===n})||a[n-1];return r&&/^\\d{2}$/.test(String(r.result||''))?String(r.result):'--'}
  function render(items){document.getElementById('historyGrid').innerHTML=TIMES.map(function(t,i){return '<div class="slot"><div class="slot-time">'+splitTime(t)+'</div><div class="result">'+resultForRound(items,i+1)+'</div></div>'}).join('')}
  async function load(){var input=document.getElementById('historyDate');var date=input.value||todayYangon();document.getElementById('dateText').textContent=fmtDate(date);document.getElementById('message').textContent='';try{var res=await fetch('/api/history?date='+encodeURIComponent(date)+'&days=1',{cache:'no-store'});var data=await res.json();if(!res.ok||!data.success)throw new Error(data.message||'History could not be loaded');var items=[];if(Array.isArray(data.records)&&data.records[0])items=Array.isArray(data.records[0].items)?data.records[0].items:[];else if(Array.isArray(data.items))items=data.items;render(items)}catch(e){render([]);document.getElementById('message').textContent=e.message||'History could not be loaded.'}}
  var input=document.getElementById('historyDate');input.max=todayYangon();input.value=todayYangon();input.addEventListener('change',load);document.getElementById('calendarBtn').addEventListener('click',function(){if(input.showPicker)input.showPicker();else input.click()});render([]);load();
})();
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
<title>New Zealand 2D Admin</title>
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
<h1>New Zealand 2D Admin</h1>
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
var ADMIN_TIMES=["05:00 PM","06:00 PM","07:00 PM","08:00 PM","09:00 PM","10:00 PM","11:00 PM","12:00 AM"];
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
    if (!Array.isArray(body.results) || body.results.length !== 8) {
      throw new HttpError(400, "2D ဂဏန်း ၈ ခုလုံးထည့်ပါ");
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
      message: date + " အတွက် 2D ဂဏန်း ၈ ခု သိမ်းပြီးပါပြီ",
      items
    });
  }

  if (url.pathname === "/api/admin/history/upsert") {
    const date = String(body.date || "");
    const roundNumber = Number(body.round);

    if (!isRealDate(date)) {
      throw new HttpError(400, "History Date မှားနေပါတယ်");
    }
    if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 8) {
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
    if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 8) {
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
