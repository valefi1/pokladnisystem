# v1.25 - import product rows only, no stale full sync overwrite

Fixes stock snapshot / Dotykacka import persistence:

- Imported product rows are written directly to `public.pos_products` and verified.
- The import path no longer runs a full product state sync immediately after the direct import.
- Remote Supabase product rows now take precedence over local cached rows when choosing which product ID to update.
- This prevents stale local/cache products from creating duplicates or overwriting newly imported prices/VAT/stock.

Build verified with `npm run build`.
