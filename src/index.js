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


/* ========================================
   JSON RESPONSE
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
   TARTAY 2D OPERATIONAL DATE
======================================== */

/*
  Tartay 2D operational day:

  05:00 PM → 11:59 PM
  12:00 AM → 04:59 PM

  Example:

  Aug 8
  05:00 PM
  06:00 PM
  ...
  11:00 PM
  Aug 9 12:00 AM

  That 12:00 AM result is still stored
  under Aug 8 as the 8th/final round.
*/

function getMyanmarDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const year = Number(
    parts.find(p => p.type === "year")?.value
  );

  const month = Number(
    parts.find(p => p.type === "month")?.value
  );

  const day = Number(
    parts.find(p => p.type === "day")?.value
  );

  const hour = Number(
    parts.find(p => p.type === "hour")?.value
  );


  let operationalDate = new Date(
    Date.UTC(
      year,
      month - 1,
      day
    )
  );


  /*
    Before 5 PM Myanmar time,
    still use previous Tartay 2D day.
  */

  if (hour < 17) {
    operationalDate.setUTCDate(
      operationalDate.getUTCDate() - 1
    );
  }


  const finalYear =
    operationalDate.getUTCFullYear();

  const finalMonth =
    String(
      operationalDate.getUTCMonth() + 1
    ).padStart(2, "0");

  const finalDay =
    String(
      operationalDate.getUTCDate()
    ).padStart(2, "0");


  return `${finalYear}-${finalMonth}-${finalDay}`;
}


/* ========================================
   TOKEN HELPERS
======================================== */

function base64UrlEncode(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function base64UrlDecode(value) {
  value =
    value
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
    [
      "sign",
      "verify"
    ]
  );
}


/* ========================================
   CREATE ADMIN TOKEN
======================================== */

async function createAdminToken(secret) {
  const payload = {
    role: "admin",

    exp:
      Math.floor(
        Date.now() / 1000
      ) +
      (12 * 60 * 60)
  };


  const payloadText =
    JSON.stringify(payload);


  const payloadBytes =
    new TextEncoder()
      .encode(payloadText);


  const encodedPayload =
    base64UrlEncode(
      payloadBytes
    );


  const key =
    await getSigningKey(
      secret
    );


  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder()
        .encode(
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
   VERIFY ADMIN TOKEN
======================================== */

async function verifyAdminToken(
  token,
  secret
) {

  try {

    if (
      !token ||
      !secret
    ) {
      return false;
    }


    const [
      payloadPart,
      signaturePart
    ] =
      token.split(".");


    if (
      !payloadPart ||
      !signaturePart
    ) {
      return false;
    }


    const key =
      await getSigningKey(
        secret
      );


    const valid =
      await crypto.subtle.verify(
        "HMAC",
        key,
        base64UrlDecode(
          signaturePart
        ),
        new TextEncoder()
          .encode(
            payloadPart
          )
      );


    if (!valid) {
      return false;
    }


    const payloadText =
      new TextDecoder()
        .decode(
          base64UrlDecode(
            payloadPart
          )
        );


    const payload =
      JSON.parse(
        payloadText
      );


    if (
      payload.role !==
      "admin"
    ) {
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
    !authorization
      .startsWith(
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
   READ JSON BODY
======================================== */

async function readJson(
  request
) {

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
    await readJson(
      request
    );


  if (
    !body ||
    typeof body.password !==
      "string"
  ) {

    return json({
      success: false,
      error:
        "Password is required."
    }, 400);

  }


  if (
    !env.ADMIN_PASSWORD
  ) {

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
      error:
        "Invalid password."
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
   SAVE / UPDATE RESULT
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
      error:
        "Unauthorized."
    }, 401);

  }


  const body =
    await readJson(
      request
    );


  if (!body) {

    return json({
      success: false,
      error:
        "Invalid JSON body."
    }, 400);

  }


  /*
    Default date is the
    Tartay operational day.
  */

  const resultDate =
    String(
      body.result_date ||
      getMyanmarDate()
    ).trim();


  const roundTime =
    String(
      body.round_time ||
      ""
    ).trim();


  const result2d =
    String(
      body.result_2d ||
      ""
    ).trim();


  const setValue =
    body.set_value ===
      null ||
    body.set_value ===
      undefined
      ? null
      : String(
          body.set_value
        ).trim();


  const valueValue =
    body.value_value ===
      null ||
    body.value_value ===
      undefined
      ? null
      : String(
          body.value_value
        ).trim();


  /*
    Validate date
  */

  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        resultDate
      )
  ) {

    return json({
      success: false,
      error:
        "result_date must use YYYY-MM-DD format."
    }, 400);

  }


  /*
    Validate round
  */

  if (
    !ROUNDS.includes(
      roundTime
    )
  ) {

    return json({
      success: false,
      error:
        "Invalid round_time."
    }, 400);

  }


  /*
    Validate 2D number
  */

  if (
    !/^\d{2}$/
      .test(
        result2d
      )
  ) {

    return json({
      success: false,
      error:
        "result_2d must be exactly 2 digits."
    }, 400);

  }


  /*
    Insert result.

    If same date + same round
    already exists,
    update that row.
  */

  await env.DB
    .prepare(`
      INSERT INTO app_results (
        result_date,
        round_time,
        result_2d,
        set_value,
        value_value,
        created_at,
        updated_at
      )

      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
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

        updated_at =
          CURRENT_TIMESTAMP
    `)

    .bind(
      resultDate,
      roundTime,
      result2d,
      setValue,
      valueValue
    )

    .run();


  return json({
    success: true,

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
        valueValue
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

  /*
    If date query exists:
      use that exact date.

    Otherwise:
      use Tartay operational date.
  */

  const resultDate =
    url.searchParams.get(
      "date"
    ) ||
    getMyanmarDate();


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
          created_at,
          updated_at

        FROM app_results

        WHERE result_date = ?

        ORDER BY

          CASE round_time

            WHEN '05:00 PM'
              THEN 1

            WHEN '06:00 PM'
              THEN 2

            WHEN '07:00 PM'
              THEN 3

            WHEN '08:00 PM'
              THEN 4

            WHEN '09:00 PM'
              THEN 5

            WHEN '10:00 PM'
              THEN 6

            WHEN '11:00 PM'
              THEN 7

            WHEN '12:00 AM'
              THEN 8

            ELSE 99

          END
      `)

      .bind(
        resultDate
      )

      .all();


  return json({
    success: true,
    date: resultDate,
    rounds: ROUNDS,
    results:
      response.results || []
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
    !Number.isInteger(
      limit
    ) ||
    limit < 1
  ) {

    limit = 100;

  }


  if (
    limit > 500
  ) {

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
          created_at,
          updated_at

        FROM app_results

        ORDER BY

          result_date DESC,

          CASE round_time

            WHEN '12:00 AM'
              THEN 8

            WHEN '11:00 PM'
              THEN 7

            WHEN '10:00 PM'
              THEN 6

            WHEN '09:00 PM'
              THEN 5

            WHEN '08:00 PM'
              THEN 4

            WHEN '07:00 PM'
              THEN 3

            WHEN '06:00 PM'
              THEN 2

            WHEN '05:00 PM'
              THEN 1

            ELSE 0

          END DESC

        LIMIT ?
      `)

      .bind(
        limit
      )

      .all();


  return json({
    success: true,
    results:
      response.results || []
  });
}


/* ========================================
   DURABLE OBJECT
======================================== */

export class RoundAlarm {

  constructor(
    state,
    env
  ) {

    this.state =
      state;

    this.env =
      env;

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
      Reserved for future
      Tartay 2D scheduled
      round processing.
    */

  }
}


/* ========================================
   WORKER
======================================== */

export default {

  async fetch(
    request,
    env
  ) {

    try {

      const url =
        new URL(
          request.url
        );


      /* STATUS */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/status"
      ) {

        return json({
          app:
            "Tartay 2D",

          status:
            "Online",

          version:
            "2.1.0",

          database:
            "connected",

          operational_date:
            getMyanmarDate()
        });

      }


      /* ADMIN LOGIN */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/admin/login"
      ) {

        return handleAdminLogin(
          request,
          env
        );

      }


      /* ADMIN SAVE RESULT */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/admin/result"
      ) {

        return handleSaveResult(
          request,
          env
        );

      }


      /* TODAY RESULTS */

      if (
        request.method ===
          "GET" &&
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
        request.method ===
          "GET" &&
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
        url.pathname
          .startsWith(
            "/api/"
          )
      ) {

        return json({
          success: false,
          error:
            "API route not found."
        }, 404);

      }


      /* STATIC FILES */

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
