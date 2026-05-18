# v1.28 - stock import DB column alignment and detailed Supabase errors

- Stock snapshot import writes only the real columns present in `public.pos_products`:
  `owner_id`, `id`, `name`, `category`, `barcode`, `plu`, `price`, `stock`, `hidden`, `payload`, `updated_at`, `price_with_vat`, `price_without_vat`, `vat_rate`.
- Product rows are sanitized before Supabase upsert so JSON payload cannot contain invalid `NaN` / `undefined` values.
- Import errors now include Supabase `message`, `code`, `details`, `hint`, and `status` where available instead of only showing `Bad Request`.
- Presentation updates keep using only presentation payload changes and do not touch price/VAT/stock columns.
