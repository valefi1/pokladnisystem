# v1.21 – Stabilní barvy produktů a bezpečné řazení

- Každý produkt může mít vlastní barvu dlaždice z předvybrané palety.
- Barva se ukládá jako parametr produktu (`tileColor`) a synchronizuje se přes Supabase v JSON payloadu.
- Barvu lze změnit v detailu produktu nebo přímo v panelu „Pořadí dlaždic v pokladně“.
- Řazení produktů a změna barvy už nepřepisují ceny, DPH, sklad ani další produktová pole.
- Přidán speciální presentation-only sync pro `displayOrder` a `tileColor`, který při zápisu zachová aktuální cenové sloupce v Supabase.
- Build ověřen přes `npm run build`.

Není potřeba nová Supabase migrace.
