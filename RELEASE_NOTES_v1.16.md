# v1.16 - pokladní layout, kategorie, modaly a oprava cen DPH

- Přidán jednořádkový pás kategorií s horizontálním posunem.
- Přidáno tlačítko „Všechny kategorie“, které otevře popup s kategoriemi jako dlaždice. Po výběru kategorie se popup zavře.
- V režimu Pokladna se schovává horní aplikační lišta, aby na tabletu zůstalo více místa pro prodej.
- Upravené scrollování modalů: platební dialog, detail produktu, vážené množství i editace položky scrollují samy, ne stránka pod nimi.
- Přidán použitelnější mobilní režim: skryté menu, 2 sloupce produktů, kompaktní účty a košík.
- Přidán jednorázový SQL skript `supabase/fix_existing_product_prices_net_to_gross.sql` pro opravu existujících cen, které byly původně bez DPH.

## Oprava aktuálních cen
Pokud jsou tvoje aktuální ceny v databázi bez DPH, ale aplikace je ukazuje jako s DPH, spusť v Supabase SQL editoru přesně jednou:

```sql
-- viz soubor supabase/fix_existing_product_prices_net_to_gross.sql
```

Potom znovu načti aplikaci.
