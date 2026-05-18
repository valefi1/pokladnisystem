# v1.17 - Supabase load repair

- Fixed Supabase loading so rows are read from actual table columns, not only from JSON payload.
- Fixed demo data leaking into online mode when Supabase loading fails.
- Added loading/error screen before showing cash register, so the app does not ask to open the cash drawer before Supabase state is loaded.
- Added compatibility with older `pos_setting` table while using the correct `pos_settings` table going forward.
- Added `supabase/repair_supabase_schema_v1_17.sql` for safe database repair.
