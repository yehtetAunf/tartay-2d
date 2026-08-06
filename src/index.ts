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
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Login page
    if (url.pathname === "/" && request.method === "GET") {
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <title>Tartay 2D Login</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      font-family: Arial, sans-serif;
      background: #111827;
      color: white;
    }

    .login-box {
      width: 100%;
      max-width: 360px;
      padding: 28px;
      border-radius: 16px;
      background: #1f2937;
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.35);
    }

    h2 {
      margin-top: 0;
      text-align: center;
    }

    input {
      width: 100%;
      padding: 13px;
      margin-top: 12px;
      border: 1px solid #4b5563;
      border-radius: 8px;
      background: #111827;
      color: white;
      font-size: 16px;
    }

    button {
      width: 100%;
      padding: 13px;
      margin-top: 16px;
      border: none;
      border-radius: 8px;
      background: #2563eb;
      color: white;
      font-size: 16px;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    #result {
      min-height: 24px;
      margin-top: 16px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: #d1d5db;
    }
  </style>
</head>

<body>
  <div class="login-box">
    <h2>Tartay 2D Admin Login</h2>

    <input
      id="username"
      type="text"
      placeholder="Username"
      autocomplete="username"
    >

    <input
      id="password"
      type="password"
      placeholder="Password"
      autocomplete="current-password"
    >

    <button id="loginButton" type="button" onclick="login()">
      Login
    </button>

    <div id="result"></div>
  </div>

  <script>
    async function login() {
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;
      const result = document.getElementById("result");
      const button = document.getElementById("loginButton");

      if (!username || !password) {
        result.textContent = "Username and password are required.";
        return;
      }

      button.disabled = true;
      button.textContent = "Logging in...";
      result.textContent = "";

      try {
        const response = await fetch("/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username,
            password
          })
        });

        const data = await response.json();

        if (!response.ok) {
          result.textContent = data.message || "Login failed.";
          return;
        }

        result.textContent =
          "Login successful\\n" +
          "Name: " + data.user.full_name + "\\n" +
          "Role: " + data.user.role;
      } catch {
        result.textContent = "Network error. Please try again.";
      } finally {
        button.disabled = false;
        button.textContent = "Login";
      }
    }
  </script>
</body>
</html>
`;

      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
        },
      });
    }

    // Test API
    if (url.pathname === "/test" && request.method === "GET") {
      return json({
        success: true,
        message: "Tartay 2D API Working",
      });
    }

    // Temporary users API
    if (url.pathname === "/users" && request.method === "GET") {
      const users = await env.DB.prepare(
        `SELECT id, username, full_name, role, status, created_at
         FROM users`,
      ).all();

      return json({
        success: true,
        users: users.results,
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
        `SELECT
           id,
           username,
           password_hash,
           full_name,
           role,
           status
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
