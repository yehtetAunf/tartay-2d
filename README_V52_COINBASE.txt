v5.2 Coinbase SET/VALUE
- Active unreleased round: SET/VALUE come from /api/state market (Coinbase BTC-USD price/volume), not random JS.
- Active row 2D stays --.
- Future rows stay -- / -- / --.
- When a round is released, current Coinbase SET/VALUE are saved into app_results if those fields are empty.
- Saved SET/VALUE remain fixed afterward and appear in history.
- Existing manually supplied SET/VALUE are never overwritten.
- Big 2D keeps existing server pre-spin/result-hold timing.
