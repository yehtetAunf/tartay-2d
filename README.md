# Tartay 2D Clean v3
Fresh project written for Tartay 2D. It does not reuse the old Tartay login/balance/bet/wallet/customer code.

Functions: public live result, 8 scheduled rounds (5 PM to 12 AM Yangon time), admin pre-set SET/VALUE/2D, scheduled reveal, result history, KV storage, backup API, live/pause API.

## Before deploy
1. Create a Cloudflare KV namespace.
2. Replace PUT_YOUR_KV_NAMESPACE_ID_HERE in wrangler.jsonc with its ID.
3. Add Worker secret ADMIN_KEY in Cloudflare (or `npx wrangler secret put ADMIN_KEY`).
4. Deploy with `npm install` then `npm run deploy`.

Admin: /admin
User: /
History: /history
