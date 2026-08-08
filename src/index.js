export class RoundAlarm {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new Response("RoundAlarm is active", {
      status: 200
    });
  }

  async alarm() {
    // Reserved for Tartay 2D scheduled round processing
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return Response.json({
        app: "Tartay 2D",
        status: "Online",
        version: "1.0.0"
      });
    }

    return env.ASSETS.fetch(request);
  }
};
