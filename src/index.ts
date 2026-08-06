interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface LoginBody {
  username?: string;
  password?: string;
}

interface BetBody {
  customer_name?: string;
  phone?: string;
  number?: string;
  amount?: number | string;
  bet_type?: string;
}

interface ResultBody {
  result_date?: string;
  result_time?: string;
  set_value?: string;
  market_value?: string;
  result_number?: string;
}

const RESULT_TIMES = [
  "5:00 PM",
  "6:00 PM",
  "7:00 PM",
  "8:00 PM",
  "9:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM"
] as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function validTime(value: string): boolean {
  return RESULT_TIMES.includes(
    value as (typeof RESULT_TIMES)[number]
  );
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayMyanmar(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const getPart = (type: string): string =>
    parts.find((part) => part.type === type)?.value || "";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

async function ensureResultTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS result_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_date TEXT NOT NULL,
      result_time TEXT NOT NULL,
      set_value TEXT NOT NULL DEFAULT '--',
      market_value TEXT NOT NULL DEFAULT '--',
      result_number TEXT NOT NULL DEFAULT '--',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(result_date, result_time)
    )
  `).run();
}

async function ensureDay(
  db: D1Database,
  date: string
): Promise<void> {
  await ensureResultTable(db);

  const statements = RESULT_TIMES.map((time) =>
    db.prepare(`
      INSERT OR IGNORE INTO result_records
      (result_date, result_time)
      VALUES (?, ?)
    `).bind(date, time)
  );

  await db.batch(statements);
}

const orderSql = `
  CASE result_time
    WHEN '5:00 PM' THEN 1
    WHEN '6:00 PM' THEN 2
    WHEN '7:00 PM' THEN 3
    WHEN '8:00 PM' THEN 4
    WHEN '9:00 PM' THEN 5
    WHEN '10:00 PM' THEN 6
    WHEN '11:00 PM' THEN 7
    WHEN '12:00 AM' THEN 8
    ELSE 99
  END
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      // ==================== LOGIN ====================

      if (
        url.pathname === "/login" &&
        request.method === "POST"
      ) {
        let body: LoginBody;

        try {
          body = await request.json<LoginBody>();
        } catch {
          return json(
            {
              success: false,
              message: "Invalid JSON data"
            },
            400
          );
        }

        const username = body.username?.trim();
        const password = body.password;

        if (!username || !password) {
          return json(
            {
              success: false,
              message: "Username and password are required"
            },
            400
          );
        }

        const user = await env.DB.prepare(`
          SELECT
            id,
            username,
            password_hash,
            full_name,
            role,
            status
          FROM users
          WHERE username = ?
          LIMIT 1
        `)
          .bind(username)
          .first<{
            id: number;
            username: string;
            password_hash: string;
            full_name: string;
            role: string;
            status: number;
          }>();

        if (
          !user ||
          user.status !== 1 ||
          user.password_hash !== password
        ) {
          return json(
            {
              success: false,
              message: "Invalid username or password"
            },
            401
          );
        }

        return json({
          success: true,
          message: "Login successful",
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role
          }
        });
      }

      // ==================== GET BETS ====================

      if (
        url.pathname === "/api/bets" &&
        request.method === "GET"
      ) {
        const bets = await env.DB.prepare(`
          SELECT
            id,
            customer_name,
            phone,
            number,
            amount,
            bet_type,
            status,
            created_at
          FROM bets
          ORDER BY id DESC
        `).all();

        return json({
          success: true,
          bets: bets.results
        });
      }

      // ==================== CREATE BET ====================

      if (
        url.pathname === "/api/bets" &&
        request.method === "POST"
      ) {
        let body: BetBody;

        try {
          body = await request.json<BetBody>();
        } catch {
          return json(
            {
              success: false,
              message: "Invalid JSON data"
            },
            400
          );
        }

        const customer = body.customer_name?.trim();
        const phone = body.phone?.trim() || "";
        const number = body.number?.trim();
        const amount = Number(body.amount);
        const time = body.bet_type?.trim();

        if (!customer || !number || !time) {
          return json(
            {
              success: false,
              message:
                "Customer, number and result time are required"
            },
            400
          );
        }

        if (!/^\d{2}$/.test(number)) {
          return json(
            {
              success: false,
              message:
                "2D Number must contain exactly 2 digits"
            },
            400
          );
        }

        if (!validTime(time)) {
          return json(
            {
              success: false,
              message: "Invalid result time"
            },
            400
          );
        }

        if (!Number.isInteger(amount) || amount <= 0) {
          return json(
            {
              success: false,
              message:
                "Amount must be a positive whole number"
            },
            400
          );
        }

        const result = await env.DB.prepare(`
          INSERT INTO bets (
            customer_name,
            phone,
            number,
            amount,
            bet_type,
            status
          )
          VALUES (?, ?, ?, ?, ?, 'pending')
        `)
          .bind(
            customer,
            phone,
            number,
            amount,
            time
          )
          .run();

        return json(
          {
            success: true,
            message: "Bet saved successfully",
            bet_id: result.meta.last_row_id
          },
          201
        );
      }

      // ==================== GET RESULTS ====================

      if (
        url.pathname === "/api/results" &&
        request.method === "GET"
      ) {
        const date =
          url.searchParams.get("date") || todayMyanmar();

        if (!validDate(date)) {
          return json(
            {
              success: false,
              message: "Invalid date format"
            },
            400
          );
        }

        await ensureDay(env.DB, date);

        const rows = await env.DB.prepare(`
          SELECT
            id,
            result_date,
            result_time,
            set_value,
            market_value,
            result_number,
            updated_at
          FROM result_records
          WHERE result_date = ?
          ORDER BY ${orderSql}
        `)
          .bind(date)
          .all();

        return json({
          success: true,
          date,
          results: rows.results
        });
      }

      // ==================== RESULT HISTORY ====================

      if (
        url.pathname === "/api/results/history" &&
        request.method === "GET"
      ) {
        await ensureResultTable(env.DB);

        const dates = await env.DB.prepare(`
          SELECT DISTINCT result_date
          FROM result_records
          WHERE result_number != '--'
          ORDER BY result_date DESC
          LIMIT 60
        `).all();

        return json({
          success: true,
          dates: dates.results
        });
      }

      // ==================== PUBLISH RESULT ====================

      if (
        url.pathname === "/api/results" &&
        request.method === "POST"
      ) {
        let body: ResultBody;

        try {
          body = await request.json<ResultBody>();
        } catch {
          return json(
            {
              success: false,
              message: "Invalid JSON data"
            },
            400
          );
        }

        const date =
          body.result_date?.trim() || todayMyanmar();

        const time = body.result_time?.trim();

        const setValue =
          body.set_value?.trim() || "--";

        const marketValue =
          body.market_value?.trim() || "--";

        const number =
          body.result_number?.trim();

        if (!validDate(date)) {
          return json(
            {
              success: false,
              message: "Invalid result date"
            },
            400
          );
        }

        if (!time || !validTime(time)) {
          return json(
            {
              success: false,
              message: "Invalid result time"
            },
            400
          );
        }

        if (!number || !/^\d{2}$/.test(number)) {
          return json(
            {
              success: false,
              message:
                "Result number must contain exactly 2 digits"
            },
            400
          );
        }

        await ensureDay(env.DB, date);

        /*
          Cloudflare D1 created_at က UTC ဖြစ်နိုင်သောကြောင့်
          Myanmar date ရရှိရန် +6 hours +30 minutes ထည့်ထားသည်။
        */

        const resultUpdate = env.DB.prepare(`
          UPDATE result_records
          SET
            set_value = ?,
            market_value = ?,
            result_number = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE result_date = ?
            AND result_time = ?
        `).bind(
          setValue,
          marketValue,
          number,
          date,
          time
        );

        const betUpdate = env.DB.prepare(`
          UPDATE bets
          SET status =
            CASE
              WHEN number = ? THEN 'win'
              ELSE 'lose'
            END
          WHERE bet_type = ?
            AND DATE(
              created_at,
              '+6 hours',
              '+30 minutes'
            ) = ?
        `).bind(
          number,
          time,
          date
        );

        const batchResult = await env.DB.batch([
          resultUpdate,
          betUpdate
        ]);

        const betChanges =
          batchResult[1]?.meta?.changes || 0;

        return json({
          success: true,
          message: "Result published successfully",
          result: {
            date,
            time,
            number,
            set_value: setValue,
            market_value: marketValue
          },
          bets_updated: betChanges
        });
      }

      // ==================== API NOT FOUND ====================

      if (url.pathname.startsWith("/api/")) {
        return json(
          {
            success: false,
            message: "Not Found"
          },
          404
        );
      }

      // ==================== STATIC FILES ====================

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Worker error:", error);

      return json(
        {
          success: false,
          message: "Internal server error"
        },
        500
      );
    }
  }
};
