# v1.24 – ověřený zápis importu do Supabase

- Import stavu skladu a import z Dotykačky nově provádí přímý upsert importovaných produktů do `public.pos_products`.
- Po upsertu se data hned znovu načtou ze Supabase a ověří se `price`, `price_with_vat`, `price_without_vat`, `vat_rate` a `stock`.
- Pokud Supabase zápis neproběhne nebo se hodnoty v databázi neshodují s importem, import skončí chybou a nebude hlásit úspěch.
- Cílem je zabránit tomu, aby se po refreshi vrátily staré ceny/sklady/DPH z databáze.
