const ROUNDS = [
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
  "08:00 PM",
  "09:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM"
];

const ROUND_RELEASE_HOURS = {
  "05:00 PM": 17,
  "06:00 PM": 18,
  "07:00 PM": 19,
  "08:00 PM": 20,
  "09:00 PM": 21,
  "10:00 PM": 22,
  "11:00 PM": 23,
  "12:00 AM": 24
};


/* ========================================
   JSON
======================================== */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}


/* ========================================
   DATE HELPERS
======================================== */

function formatDateUTC(date) {
  const year = date.getUTCFullYear();

  const month = String(
    date.getUTCMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getUTCDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function parseDateUTC(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return null;
  }

  const [year, month, day] =
    dateString.split("-").map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}


/* ========================================
   MYANMAR TIME
======================================== */

function getMyanmarNow() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "Asia/Yangon",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    ).formatToParts(new Date());

  const getPart = type =>
    Number(
      parts.find(
        p => p.type === type
      )?.value
    );

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
    second: getPart("second")
  };
}


/* ========================================
   OPERATIONAL DATE
======================================== */

/*
  Tartay Operational Day

  05:00 PM = Round 1
  ...
  11:00 PM = Round 7
  Next calendar day
  12:00 AM = Round 8

  Before 5 PM Myanmar time,
  operational date = previous date.
*/

function getMyanmarDate() {
  const now = getMyanmarNow();

  const date = new Date(
    Date.UTC(
      now.year,
      now.month - 1,
      now.day
    )
  );

  if (now.hour < 17) {
    date.setUTCDate(
      date.getUTCDate() - 1
    );
  }

  return formatDateUTC(date);
}


/* ========================================
   ROUND RELEASE CHECK
======================================== */

function isRoundReleased(
  resultDate,
  roundTime
) {
  const operationalDate =
    parseDateUTC(resultDate);

  if (!operationalDate) {
    return false;
  }

  if (!ROUNDS.includes(roundTime)) {
    return false;
  }

  let releaseDate =
    new Date(
      operationalDate.getTime()
    );

  let releaseHour =
    ROUND_RELEASE_HOURS[
      roundTime
    ];

  /*
    12 AM is the next calendar day
    but still Round 8 of operational day.
  */

  if (roundTime === "12:00 AM") {
    releaseDate.setUTCDate(
      releaseDate.getUTCDate() + 1
    );

    releaseHour = 0;
  }

  const now =
    getMyanmarNow();

  const currentMyanmarTime =
    Date.UTC(
      now.year,
      now.month - 1,
      now.day,
      now.hour,
      now.minute,
      now.second
    );

  const releaseMyanmarTime =
    Date.UTC(
      releaseDate.getUTCFullYear(),
      releaseDate.getUTCMonth(),
      releaseDate.getUTCDate(),
      releaseHour,
      0,
      0
    );

  return (
    currentMyanmarTime >=
    releaseMyanmarTime
  );
}


/* ========================================
   PUBLIC VISIBILITY
======================================== */

/*
  publish_mode = now
  -> immediately visible

  publish_mode = schedule
  -> visible only after round time

  Older database rows without publish_mode
  -> treat as scheduled
*/

function isResultPublic(item) {
  const mode =
    item.publish_mode || "schedule";

  if (mode === "now") {
    return true;
  }

  if (mode === "schedule") {
    return isRoundReleased(
      item.result_date,
      item.round_time
    );
  }

  return false;
}


function filterPublicResults(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.filter(
    item => isResultPublic(item)
  );
}


/* ========================================
   TOKEN HELPERS
======================================== */

function base64UrlEncode(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function base64UrlDecode(value) {
  value = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (value.length % 4) {
    value += "=";
  }

  const binary = atob(value);

  return Uint8Array.from(
    binary,
    c => c.charCodeAt(0)
  );
}


async function getSigningKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );
}


/* ========================================
   CREATE ADMIN TOKEN
======================================== */

async function createAdminToken(secret) {
  const payload = {
    role: "admin",

    exp:
      Math.floor(Date.now() / 1000) +
      (12 * 60 * 60)
  };

  const encodedPayload =
    base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify(payload)
      )
    );

  const key =
    await getSigningKey(secret);

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        encodedPayload
      )
    );

  return (
    encodedPayload +
    "." +
    base64UrlEncode(
      new Uint8Array(signature)
    )
  );
}


/* ========================================
   VERIFY TOKEN
======================================== */

async function verifyAdminToken(
  token,
  secret
) {
  try {
    if (!token || !secret) {
      return false;
    }

    const [
      payloadPart,
      signaturePart
    ] = token.split(".");

    if (
      !payloadPart ||
      !signaturePart
    ) {
      return false;
    }

    const key =
      await getSigningKey(secret);

    const valid =
      await crypto.subtle.verify(
        "HMAC",
        key,
        base64UrlDecode(
          signaturePart
        ),
        new TextEncoder().encode(
          payloadPart
        )
      );

    if (!valid) {
      return false;
    }

    const payload =
      JSON.parse(
        new TextDecoder().decode(
          base64UrlDecode(
            payloadPart
          )
        )
      );

    if (payload.role !== "admin") {
      return false;
    }

    if (
      !payload.exp ||
      payload.exp <
        Math.floor(
          Date.now() / 1000
        )
    ) {
      return false;
    }

    return true;

  } catch {
    return false;
  }
}


/* ========================================
   REQUIRE ADMIN
======================================== */

async function requireAdmin(
  request,
  env
) {
  const authorization =
    request.headers.get(
      "Authorization"
    ) || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return false;
  }

  const token =
    authorization
      .slice(7)
      .trim();

  return verifyAdminToken(
    token,
    env.ADMIN_PASSWORD
  );
}


/* ========================================
   READ JSON
======================================== */

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}


/* ========================================
   ADMIN LOGIN
======================================== */

async function handleAdminLogin(
  request,
  env
) {
  const body =
    await readJson(request);

  if (
    !body ||
    typeof body.password !== "string"
  ) {
    return json({
      success: false,
      error: "Password is required."
    }, 400);
  }

  if (!env.ADMIN_PASSWORD) {
    return json({
      success: false,
      error:
        "ADMIN_PASSWORD secret is not configured."
    }, 500);
  }

  if (
    body.password !==
    env.ADMIN_PASSWORD
  ) {
    return json({
      success: false,
      error: "Invalid password."
    }, 401);
  }

  const token =
    await createAdminToken(
      env.ADMIN_PASSWORD
    );

  return json({
    success: true,
    token,
    expires_in: 43200
  });
}


/* ========================================
   SAVE RESULT
======================================== */

async function handleSaveResult(
  request,
  env
) {
  const authorized =
    await requireAdmin(
      request,
      env
    );

  if (!authorized) {
    return json({
      success: false,
      error: "Unauthorized."
    }, 401);
  }

  const body =
    await readJson(request);

  if (!body) {
    return json({
      success: false,
      error: "Invalid JSON body."
    }, 400);
  }

  const resultDate =
    String(
      body.result_date ||
      getMyanmarDate()
    ).trim();

  const roundTime =
    String(
      body.round_time || ""
    ).trim();

  const result2d =
    String(
      body.result_2d || ""
    ).trim();

  const setValue =
    body.set_value === null ||
    body.set_value === undefined
      ? null
      : String(
          body.set_value
        ).trim();

  const valueValue =
    body.value_value === null ||
    body.value_value === undefined
      ? null
      : String(
          body.value_value
        ).trim();


  /*
    NEW:
    schedule OR now
  */

  const publishMode =
    body.publish_mode === "now"
      ? "now"
      : "schedule";


  const autoPublish =
    body.auto_publish === false ||
    body.auto_publish === 0
      ? 0
      : 1;


  if (!parseDateUTC(resultDate)) {
    return json({
      success: false,
      error: "Invalid result_date."
    }, 400);
  }


  if (!ROUNDS.includes(roundTime)) {
    return json({
      success: false,
      error: "Invalid round_time."
    }, 400);
  }


  if (!/^\d{2}$/.test(result2d)) {
    return json({
      success: false,
      error:
        "result_2d must be exactly 2 digits."
    }, 400);
  }


  /*
    Publish Now:
      published_at = CURRENT_TIMESTAMP

    Save Schedule:
      published_at = NULL
  */

  const publishedAt =
    publishMode === "now"
      ? new Date().toISOString()
      : null;


  await env.DB
    .prepare(`
      INSERT INTO app_results (
        result_date,
        round_time,
        result_2d,
        set_value,
        value_value,
        publish_mode,
        auto_publish,
        published_at,
        created_at,
        updated_at
      )

      VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT(
        result_date,
        round_time
      )

      DO UPDATE SET

        result_2d =
          excluded.result_2d,

        set_value =
          excluded.set_value,

        value_value =
          excluded.value_value,

        publish_mode =
          excluded.publish_mode,

        auto_publish =
          excluded.auto_publish,

        published_at =
          excluded.published_at,

        updated_at =
          CURRENT_TIMESTAMP
    `)

    .bind(
      resultDate,
      roundTime,
      result2d,
      setValue,
      valueValue,
      publishMode,
      autoPublish,
      publishedAt
    )

    .run();


  const released =
    publishMode === "now"
      ? true
      : isRoundReleased(
          resultDate,
          roundTime
        );


  return json({
    success: true,

    message:
      `${roundTime} Round သိမ်းခြင်းအောင်မြင်ပါတယ်`,

    publish_mode:
      publishMode,

    released,

    result: {
      result_date:
        resultDate,

      round_time:
        roundTime,

      result_2d:
        result2d,

      set_value:
        setValue,

      value_value:
        valueValue,

      publish_mode:
        publishMode,

      auto_publish:
        autoPublish,

      published_at:
        publishedAt
    }
  });
}


/* ========================================
   TODAY RESULTS
======================================== */

async function handleTodayResults(
  url,
  env
) {
  const resultDate =
    url.searchParams.get("date") ||
    getMyanmarDate();

  if (!parseDateUTC(resultDate)) {
    return json({
      success: false,
      error: "Invalid date."
    }, 400);
  }

  const response =
    await env.DB
      .prepare(`
        SELECT
          id,
          result_date,
          round_time,
          result_2d,
          set_value,
          value_value,
          publish_mode,
          auto_publish,
          published_at,
          created_at,
          updated_at

        FROM app_results

        WHERE result_date = ?

        ORDER BY
          CASE round_time
            WHEN '05:00 PM' THEN 1
            WHEN '06:00 PM' THEN 2
            WHEN '07:00 PM' THEN 3
            WHEN '08:00 PM' THEN 4
            WHEN '09:00 PM' THEN 5
            WHEN '10:00 PM' THEN 6
            WHEN '11:00 PM' THEN 7
            WHEN '12:00 AM' THEN 8
            ELSE 99
          END
      `)

      .bind(resultDate)
      .all();


  const publicResults =
    filterPublicResults(
      response.results || []
    );


  return json({
    success: true,
    date: resultDate,
    rounds: ROUNDS,
    results: publicResults
  });
}


/* ========================================
   HISTORY
======================================== */

async function handleHistory(
  url,
  env
) {
  let limit =
    Number(
      url.searchParams.get(
        "limit"
      ) || 100
    );

  if (
    !Number.isInteger(limit) ||
    limit < 1
  ) {
    limit = 100;
  }

  if (limit > 500) {
    limit = 500;
  }


  const response =
    await env.DB
      .prepare(`
        SELECT
          id,
          result_date,
          round_time,
          result_2d,
          set_value,
          value_value,
          publish_mode,
          auto_publish,
          published_at,
          created_at,
          updated_at

        FROM app_results

        ORDER BY
          result_date DESC,

          CASE round_time
            WHEN '12:00 AM' THEN 8
            WHEN '11:00 PM' THEN 7
            WHEN '10:00 PM' THEN 6
            WHEN '09:00 PM' THEN 5
            WHEN '08:00 PM' THEN 4
            WHEN '07:00 PM' THEN 3
            WHEN '06:00 PM' THEN 2
            WHEN '05:00 PM' THEN 1
            ELSE 0
          END DESC

        LIMIT 500
      `)

      .all();


  const publicResults =
    filterPublicResults(
      response.results || []
    ).slice(0, limit);


  return json({
    success: true,
    results: publicResults
  });
}


/* ========================================
   DURABLE OBJECT
======================================== */

export class RoundAlarm {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return new Response(
      "RoundAlarm is active",
      {
        status: 200
      }
    );
  }

  async alarm() {
    /*
      Future scheduled processing.
    */
  }
}


/* ========================================
   WORKER
======================================== */

export default {
  async fetch(request, env) {
    try {
      const url =
        new URL(request.url);


      /* STATUS */

      if (
        request.method === "GET" &&
        url.pathname === "/api/status"
      ) {
        return json({
          app: "Tartay 2D",
          status: "Online",
          version: "2.4.0",
          database: "connected",
          operational_date:
            getMyanmarDate()
        });
      }


      /* LOGIN */

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/admin/login"
      ) {
        return handleAdminLogin(
          request,
          env
        );
      }


      /* SAVE / PUBLISH */

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/admin/result"
      ) {
        return handleSaveResult(
          request,
          env
        );
      }


      /* TODAY */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/results/today"
      ) {
        return handleTodayResults(
          url,
          env
        );
      }


      /* HISTORY */

      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/results/history"
      ) {
        return handleHistory(
          url,
          env
        );
      }


      /* UNKNOWN API */

      if (
        url.pathname.startsWith(
          "/api/"
        )
      ) {
        return json({
          success: false,
          error:
            "API route not found."
        }, 404);
      }


      /* STATIC FILE */

      return env.ASSETS.fetch(
        request
      );

    } catch (error) {
      console.error(
        "Tartay Worker Error:",
        error
      );

      return json({
        success: false,
        error:
          "Internal server error."
      }, 500);
    }
  }
};
