interface Env {
  DB: D1Database;
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

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Login API
    if (url.pathname === "/login" && request.method === "POST") {
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

      const user = await env.DB.prepare(
        `SELECT id, username, password_hash, full_name, role, status
         FROM users
         WHERE username = ?
         LIMIT 1`
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

    // Bet အသစ်သိမ်းရန်
    if (url.pathname === "/api/bets" && request.method === "POST") {
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

      const customerName = body.customer_name?.trim();
      const phone = body.phone?.trim() || "";
      const number = body.number?.trim();
      const amount = Number(body.amount);
      const betType = body.bet_type?.trim();

      if (!customerName || !number || !betType) {
        return json(
          {
            success: false,
            message: "Customer, number and bet type are required"
          },
          400
        );
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return json(
          {
            success: false,
            message: "Amount must be a positive whole number"
          },
          400
        );
      }

      const result = await env.DB.prepare(
        `INSERT INTO bets
         (customer_name, phone, number, amount, bet_type)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(customerName, phone, number, amount, betType)
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

    // Bet စာရင်းယူရန်
    if (url.pathname === "/api/bets" && request.method === "GET") {
      const bets = await env.DB.prepare(
        `SELECT
           id,
           customer_name,
           phone,
           number,
           amount,
           bet_type,
           status,
           created_at
         FROM bets
         ORDER BY id DESC`
      ).all();

      return json({
        success: true,
        bets: bets.results
      });
    }

    return json(
      {
        success: false,
        message: "Not Found"
      },
      404
    );
  }
};
