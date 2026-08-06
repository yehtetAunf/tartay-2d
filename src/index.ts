export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // Home
    if (url.pathname === "/") {
      return Response.json({
        app: "Tartay 2D",
        status: "Online",
        version: "1.0.0"
      });
    }

    // Login API
    if (url.pathname === "/login" && request.method === "POST") {
      const body = await request.json();

      const username = body.username;
      const password = body.password;

      const result = await env.DB.prepare(
        "SELECT * FROM users WHERE username = ?"
      )
        .bind(username)
        .first();

      if (!result) {
        return Response.json({
          success: false,
          message: "User not found"
        });
      }

      return Response.json({
        success: true,
        user: result
      });
    }

    return new Response("Not Found", {
      status: 404
    });
  }
};
