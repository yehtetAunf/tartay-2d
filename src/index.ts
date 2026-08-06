export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        app: "Tartay 2D",
        status: "Online",
        version: "1.0.0"
      });
    }

    return new Response("Not Found", {
      status: 404
    });
  }
}
