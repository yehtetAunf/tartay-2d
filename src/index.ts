export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        app: "Tartay 2D",
        status: "Online",
        version: "1.0.0"
      });
    }

    if (url.pathname === "/users" && request.method === "GET") {
      const users = await env.DB.prepare(
        "SELECT id, username, full_name, role, status, created_at FROM users"
      ).all();

      return Response.json({
        success: true,
        users: users.results
      });
    }

    return new Response("Not Found", {
      status: 404
    });
  }
};
