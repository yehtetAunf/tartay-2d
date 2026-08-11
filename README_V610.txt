Tartay 2D v6.10 Admin API fix
- Admin Load Date uses existing GET /api/admin/state with bearer token.
- Save 8 Rounds uses existing POST /api/admin/result.
- Each entered 2D is saved as schedule + auto_publish=true.
- Empty rounds remain --.
- Existing backend/public release-time rules are retained.
