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
  result_time?: string;
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
  "12:00 AM",
] as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

function isValidResultTime(value: string): boolean {
  return RESULT_TIMES.includes(value as (typeof RESULT_TIMES)[number]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Admin login
    if (url.pathname === "/login" && request.method === "POST") {
      let body: LoginBody;

      try {
        body = await request.json<LoginBody>();
      } catch {
        return json({ success: false, message: "Invalid JSON data" }, 400);
      }

      const username = body.username?.trim();
      const password = body.password;

      if (!username || !password) {
        return json(
          { success: false, message: "Username and password are required" },
          400,
        );
      }

      const user = await env.DB.prepare(
        `SELECT id, username, password_hash, full_name, role, status
         FROM users
         WHERE username = ?
         LIMIT 1`,
      )
        .bind(username)
        .first<{
          id: number;
          username: string;
          password_hash: string;
          full_name: string;
          role: string;
          status: number;
        }>();

      if (!user || user.status !== 1 || user.password_hash !== password) {
        return json(
          { success: false, message: "Invalid username or password" },
          401,
        );
      }

      return json({
        success: true,
        message: "Login successful",
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
        },
      });
    }

    // Bets list
    if (url.pathname === "/api/bets" && request.method === "GET") {
      const bets = await env.DB.prepare(
        `SELECT id, customer_name, phone, number, amount, bet_type, status, created_at
         FROM bets
         ORDER BY id DESC`,
      ).all();

      return json({ success: true, bets: bets.results });
    }

    // Add bet
    if (url.pathname === "/api/bets" && request.method === "POST") {
      let body: BetBody;

      try {
        body = await request.json<BetBody>();
      } catch {
        return json({ success: false, message: "Invalid JSON data" }, 400);
      }

      const customerName = body.customer_name?.trim();
      const phone = body.phone?.trim() || "";
      const number = body.number?.trim();
      const amount = Number(body.amount);
      const betType = body.bet_type?.trim();

      if (!customerName || !number || !betType) {
        return json(
          {
            success: false,
            message: "Customer, number and result time are required",
          },
          400,
        );
      }

      if (!/^\d{2}$/.test(number)) {
        return json(
          {
            success: false,
            message: "2D Number must contain exactly 2 digits",
          },
          400,
        );
      }

      if (!isValidResultTime(betType)) {
        return json({ success: false, message: "Invalid result time" }, 400);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return json(
          {
            success: false,
            message: "Amount must be a positive whole number",
          },
          400,
        );
      }

      const result = await env.DB.prepare(
        `INSERT INTO bets
         (customer_name, phone, number, amount, bet_type)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(customerName, phone, number, amount, betType)
        .run();

      return json(
        {
          success: true,
          message: "Bet saved successfully",
          bet_id: result.meta.last_row_id,
        },
        201,
      );
    }

    // Public live results
    if (url.pathname === "/api/results" && request.method === "GET") {
      const results = await env.DB.prepare(
        `SELECT id, result_time, result_number, created_at
         FROM results
         ORDER BY CASE result_time
           WHEN '5:00 PM' THEN 1
           WHEN '6:00 PM' THEN 2
           WHEN '7:00 PM' THEN 3
           WHEN '8:00 PM' THEN 4
           WHEN '9:00 PM' THEN 5
           WHEN '10:00 PM' THEN 6
           WHEN '11:00 PM' THEN 7
           WHEN '12:00 AM' THEN 8
           ELSE 99
         END`,
      ).all();

      return json({ success: true, results: results.results });
    }

    // Admin updates a result
    if (url.pathname === "/api/results" && request.method === "POST") {
      let body: ResultBody;

      try {
        body = await request.json<ResultBody>();
      } catch {
        return json({ success: false, message: "Invalid JSON data" }, 400);
      }

      const resultTime = body.result_time?.trim();
      const resultNumber = body.result_number?.trim();

      if (!resultTime || !isValidResultTime(resultTime)) {
        return json({ success: false, message: "Invalid result time" }, 400);
      }

      if (!resultNumber || !/^\d{2}$/.test(resultNumber)) {
        return json(
          {
            success: false,
            message: "Result number must contain exactly 2 digits",
          },
          400,
        );
      }

      await env.DB.prepare(
        `INSERT INTO results (result_time, result_number, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(result_time)
         DO UPDATE SET
           result_number = excluded.result_number,
           created_at = CURRENT_TIMESTAMP`,
      )
        .bind(resultTime, resultNumber)
        .run();

      return json({
        success: true,
        message: "Result updated successfully",
        result: { result_time: resultTime, result_number: resultNumber },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ success: false, message: "Not Found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
