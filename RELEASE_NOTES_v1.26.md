# v1.26 - Stock snapshot import persistence fix

- Targets the exact **Import stavu skladu** button/handler.
- Imports now match existing Supabase products by barcode, PLU, name+category and name fallback.
- If older duplicate rows exist, every matching row is updated so refresh cannot show stale duplicates.
- Import result now reports CSV rows, Supabase updated/verified rows, inserted rows, matched rows and duplicate rows updated.
- Build verified with `npm run build`.
