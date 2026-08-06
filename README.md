# Tartay 2D v1.1

Cloudflare Workers + D1 + Static Assets.

## Included

- Admin login
- Bet entry and bet list
- Result management for 5:00 PM through 12:00 AM
- Public User App at `/user.html`
- Public live results API: `GET /api/results`
- Admin result update API: `POST /api/results`

## Existing test login

- Username: `admin`
- Password: `123456`

Change the test password before real use. The current authentication is an early development version.

## Deployment

Replace the matching files in the GitHub `tartay-2d` repository. Cloudflare Git integration will deploy automatically.
