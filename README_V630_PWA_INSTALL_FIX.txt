v6.30 PWA install fix
- Corrected manifest icon URLs from /icons/icon-*.png to the actual deployed /icon-*.png files.
- Kept 192x192 and 512x512 install icons.
- Added separate maskable icon declaration.
- Bumped service-worker/manifest cache version.
- No 2D, SET/VALUE, History, Admin, timing, or result logic changed.

After deployment:
1. In Chrome, remove the old Tartay 2D shortcut if one exists.
2. Chrome > Settings > Site settings > All sites > your workers.dev site > Clear & reset.
3. Reopen the workers.dev site and wait a few seconds.
4. Chrome menu > Install app / Install and create shortcut.
