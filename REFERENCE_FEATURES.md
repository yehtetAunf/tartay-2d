# Tartay 2D v2.7 — Reference behavior adaptation

Adapted from the user-provided `nz-six-times-2d-main` behavior while keeping the existing Tartay 2D customer, wallet, bet and payout system.

## Included in v2.7

- Fixed Tartay schedule: 5:00 PM, 6:00 PM, 7:00 PM, 8:00 PM, 9:00 PM, 10:00 PM, 11:00 PM, 12:00 AM.
- Admin can save a future final result before its time.
- The public API hides the final 2D, SET and VALUE until the configured time arrives.
- At the exact scheduled time, the result is automatically published when the app/API polls.
- 15-second pre-spin animation before the result time, using nearby two-digit values similar to the reference app.
- Final result reveal animation.
- Waiting rounds display `--`; published rounds display only the fixed result chosen by Admin.
- User bets remain open until the round time itself, even when Admin has already scheduled the hidden result.
- When the result is published: WIN/LOSE settlement + 95x payout + wallet credit + payout history remain supported.
- User result page is compact to show all eight rounds with a fixed bottom `2D ထိုးမယ်` button.
- `2D ထိုးမယ်` opens a bottom sheet for login, balance, bet entry and My Bets.
- SET / VALUE input automatically suggests the 2D result using the same last-digit calculation style as the reference app.

## Existing Tartay features retained

- Admin login/dashboard
- Customer accounts and password reset
- Deposit / withdraw
- Wallet history
- User login and wallet balance
- User betting and My Bets
- Bet list and reports cards
- 95x payout
- Result history

## Notes

The supplied New Zealand project also contains its own KV/Durable Object alarm, Turnstile, JSON backup/restore and server-log administration. v2.7 reproduces the public scheduled-result behavior inside the current Tartay D1 architecture instead of replacing the whole application with that separate storage/security stack.
