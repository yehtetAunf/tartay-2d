v6.24 — SET/VALUE preservation fix only
- Admin saving/editing a 2D result no longer overwrites an already stored SET/VALUE with null/blank values.
- Corrected released-round detection in the existing SET/VALUE lock routine so missing released values can be filled instead of remaining --.
- All other v6.23 behavior is unchanged.
Note: values already erased in the database before this fix cannot be reconstructed exactly from the ZIP alone; the app will repopulate missing released values using its existing live-market lock behavior.
