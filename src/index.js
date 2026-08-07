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

const KEY = "tartay_clean_state_v1";
const OFFSET = 390;

function yparts(d = new Date()) {
  let p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(d);

  let o = {};
  p.forEach(x => (o[x.type] = x.value));
  return o;
}

function today() {
  let p = yparts();
  return `${p.year}-${p.month}-${p.day}`;
}

function nowText() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: true
  }).format(new Date());
}

function mins(t) {
  let m = t.match(/(\d+):(\d+)\s+(AM|PM)/);
  let h = +m[1];
  let n = +m[2];

  if (h === 12) h = 0;
  if (m[3] === "PM") h += 12;

  return h * 60 + n;
}

function epoch(date, time) {
  let [Y, M, D] = date.split("-").map(Number);
  let mm = mins(time);

  return Date.UTC(
    Y,
    M - 1,
    D,
    Math.floor(mm / 60),
    mm % 60
  ) - OFFSET * 60000;
}

function fresh() {
  return {
    date: today(),
    live: true,
    baseSet: "",
    baseValue: "",
    rounds: TIMES.map((time, i) => ({
      id: i + 1,
      time,
      result: "",
      set: "",
      value: "",
      publishedAt: null
    })),
    updatedAt: new Date().toISOString()
  };
}

async function state(env) {
  let s = await env.DATA.get(KEY, "json");

  if (!s || s.date !== today()) {
    if (s) await archive(env, s);

    s = fresh();
    await save(env, s);
  }

  return s;
}

async function save(env, s) {
  s.updatedAt = new Date().toISOString();
  await env.DATA.put(KEY, JSON.stringify(s));
}

async function archive(env, s) {
  let done = s.rounds.filter(r => r.publishedAt);

  if (done.length) {
    await env.DATA.put(
      `history:${s.date}`,
      JSON.stringify({
        date: s.date,
        rounds: done
      })
    );
  }
}

function publicState(s) {
  let now = Date.now();

  let rounds = s.rounds.map(r => {
    let due = epoch(s.date, r.time);
    let show = !!r.publishedAt && now >= due;

    return {
      ...r,
      result: show ? r.result : "--",
      set: show ? r.set : "--",
      value: show ? r.value : "--",
      publishedAt: show ? r.publishedAt : null
    };
  });

  let pub = rounds.filter(r => r.publishedAt);

  return {
    date: s.date,
    live: s.live,
    updatedAt: s.updatedAt,
    latest: pub.at(-1) || null,
    rounds
  };
}

function j(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function auth(req, env) {
  let got = req.headers.get("x-admin-key") || "";
  return env.ADMIN_KEY && got === env.ADMIN_KEY;
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function history(env, url) {
  let date = url.searchParams.get("date") || today();

  let one = await env.DATA.get(
    `history:${date}`,
    "json"
  );

  if (date === today()) {
    let s = await state(env);

    one = {
      date,
      rounds: publicState(s).rounds.filter(
        r => r.publishedAt
      )
    };
  }

  return j(
    one || {
      date,
      rounds: []
    }
  );
}

/* =========================
   DURABLE OBJECT
========================= */

export class RoundAlarm {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return j({
      success: true,
      message: "RoundAlarm active"
    });
  }

  async alarm() {
    await state(this.env);
  }
}

/* =========================
   MAIN WORKER
========================= */

export default {
  async fetch(req, env) {
    let u = new URL(req.url);

    if (u.pathname === "/api/state") {
      return j(
        publicState(
          await state(env)
        )
      );
    }

    if (u.pathname === "/api/history") {
      return history(env, u);
    }

    if (u.pathname.startsWith("/api/admin/")) {
      if (!auth(req, env)) {
        return j(
          { error: "Unauthorized" },
          401
        );
      }

      let s = await state(env);

      if (u.pathname === "/api/admin/state") {
        return j(s);
      }

      if (
        u.pathname === "/api/admin/live" &&
        req.method === "POST"
      ) {
        let b = await body(req);

        s.live = !!b.live;

        await save(env, s);

        return j({
          ok: true,
          state: s
        });
      }

      if (
        u.pathname === "/api/admin/round" &&
        req.method === "POST"
      ) {
        let b = await body(req);
        let r = s.rounds[Number(b.index)];

        if (!r) {
          return j(
            { error: "Invalid round" },
            400
          );
        }

        let result = String(
          b.result || ""
        ).padStart(2, "0");

        if (!/^\d{2}$/.test(result)) {
          return j(
            { error: "2D must be 00-99" },
            400
          );
        }

        r.result = result;
        r.set = String(b.set || "");
        r.value = String(b.value || "");

        r.publishedAt = new Date(
          epoch(s.date, r.time)
        ).toISOString();

        await save(env, s);

        return j({
          ok: true,
          state: s
        });
      }

      if (
        u.pathname === "/api/admin/unpublish" &&
        req.method === "POST"
      ) {
        let b = await body(req);
        let r = s.rounds[Number(b.index)];

        if (!r) {
          return j(
            { error: "Invalid round" },
            400
          );
        }

        Object.assign(r, {
          result: "",
          set: "",
          value: "",
          publishedAt: null
        });

        await save(env, s);

        return j({
          ok: true,
          state: s
        });
      }

      if (u.pathname === "/api/admin/backup") {
        return j({
          version: 1,
          app: "tartay-2d",
          state: s
        });
      }

      return j(
        { error: "Not found" },
        404
      );
    }

    if (u.pathname === "/admin") {
      return env.ASSETS.fetch(
        new Request(
          new URL("/admin.html", u),
          req
        )
      );
    }

    if (u.pathname === "/history") {
      return env.ASSETS.fetch(
        new Request(
          new URL("/history.html", u),
          req
        )
      );
    }

    if (
      u.pathname === "/" ||
      u.pathname === "/app"
    ) {
      return env.ASSETS.fetch(
        new Request(
          new URL("/user.html", u),
          req
        )
      );
    }

    return env.ASSETS.fetch(req);
  },

  async scheduled(_e, env) {
    await state(env);
  }
};
