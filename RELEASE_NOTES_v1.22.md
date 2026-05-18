# v1.22 - Import zapisuje produkty rovnou do Supabase

- Import stavu skladu a Dotykačka CSV nyní po načtení okamžitě synchronizuje výsledný stav do Supabase.
- Během importu se drží lokální stav jako zdroj pravdy a vzdálené načtení nesmí vrátit starší data zpět.
- Importní obrazovka čeká na dokončení zápisu do Supabase a ukáže chybu, pokud zápis selže.
- Ceny, DPH, sklad a další importovaná pole se po importu ukládají do sloupců `pos_products` i do `payload`.
- Ověřeno přes `npm run build`.
