export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/status') {
      return Response.json({ app: 'Tartay 2D', status: 'Online', version: '1.0.0' });
    }
    return env.ASSETS.fetch(request);
  }
};
