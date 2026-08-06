interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Home -> public/index.html
    if (url.pathname === "/") {
      return Response.redirect(new URL("/index.html", request.url), 302);
    }

    // Users API
    if (url.pathname === "/users" && request.method === "GET") {
      const users = await env.DB.prepare(
        `SELECT id, username, full_name, role, status, created_at FROM users`
      ).all();

      return Response.json({
        success: true,
        users: users.results
      });
    }

    // Login API
    if (url.pathname === "/login" && request.method === "POST") {
      const body = await request.json() as {
        username: string;
        password: string;
      };

      const user = await env.DB.prepare(
        `SELECT * FROM users WHERE username = ? LIMIT 1`
      )
      .bind(body.username)
      .first<any>();

      if (!user) {
        return Response.json(
          {
            success: false,
            message: "User not found"
          },
          {
            status: 404
          }
        );
      }

      if (user.password_hash !== body.password) {
        return Response.json(
          {
            success: false,
            message: "Wrong password"
          },
          {
            status: 401
          }
        );
      }

      return Response.json({
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

    return new Response("Not Found", {
      status: 404
    });
  }
};
