# Tartay 2D v3

Base: current Tartay 2D project. Existing core behavior is retained: 8 rounds (05:00 PM to 12:00 AM), Myanmar operational day, D1 app_results, Save Schedule, Publish Now, Auto Publish, History, and Admin login.

Added from the older NZ 2D app pattern: server-clock sync, 2-second live refresh, pre-spin display before the next round, admin round overview/edit/unpublish, D1 round locks, admin/error logs, backup/restore with safety backups, cron fallback for auto publish, PWA manifest/service worker, and richer history date browsing.

Required Cloudflare secret: ADMIN_PASSWORD
Required D1 binding: DB -> tartay-db
