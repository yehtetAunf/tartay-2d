interface Env {
  DB: D1Database;
}

interface LoginBody {
  username?: string;
  password?: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Home API
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        app: "Tartay 2D",
        status: "Online",
        version: "1.0.0",
      });
    }

    // Login API
    if (url.pathname === "/login" && request.method === "POST") {
      let body: LoginBody;

      try {
        body = await request.json<LoginBody>();
      } catch {
        return json(
          {
            success: false,
            message: "Invalid JSON data",
          },
          400,
        );
      }

      const username = body.username?.trim();
      const password = body.password;

      if (!username || !password) {
        return json(
          {
            success: false,
            message: "Username and password are required",
          },
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

      if (
        !user ||
        user.status !== 1 ||
        user.password_hash !== password
      ) {
        return json(
          {
            success: false,
            message: "Invalid username or password",
          },
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

    return json(
      {
        success: false,
        message: "Not Found",
      },
      404,
    );
  },
};
if (url.pathname === "/test") {
  return Response.json({
    success: true,
    message: "Tartay 2D API Working"
  });
          }
