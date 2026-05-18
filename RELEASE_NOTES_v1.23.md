# v1.23 - Import zapisuje produkty primo do Supabase

Oprava importu stavu skladu / Dotykacka CSV:

- import uz nesmi pouze zmenit lokalni stav aplikace,
- po importu se nejdriv primo upsertuji produkty do `public.pos_products`,
- zapisuje se `price`, `price_with_vat`, `price_without_vat`, `vat_rate`, `stock`, `barcode`, `plu`, `category`, `payload`,
- pokud Supabase neni pripravena nebo zapis selze, import skonci chybou,
- import uz nehlasi uspech, kdyz se zapsal jen lokalne,
- opravena prace se stavem pres `stateRef`, aby import nepouzil zastaraly React state.

Build: `npm run build` OK.
