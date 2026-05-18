# v1.15 VAT prices

- Prodejní ceny v pokladně jsou nově ceny s DPH.
- Produkt ukládá `price` / `priceWithVat` jako cenu s DPH a zároveň `priceWithoutVat` jako dopočtenou cenu bez DPH.
- Formulář produktu umožňuje zadat cenu s DPH i cenu bez DPH; druhá hodnota se dopočítá podle sazby DPH.
- Import skladu umí sloupec `Prodejní cena s DPH` a volitelně `DPH` / `Sazba DPH`. Pokud je k dispozici jen `Prodejní cena bez DPH`, cena s DPH se dopočítá.
- Import z Dotykačky ukládá `priceWithVAT` jako prodejní cenu s DPH a dopočítává cenu bez DPH.
- Položky účtu, účtenka a prodeje ukládají rozpad: cena s DPH, cena bez DPH, DPH, základ a celkem.
- Supabase schéma přidává sloupce `price_with_vat`, `price_without_vat`, `vat_rate`, `total_without_vat` a `vat_total`.
- Přehledy DPH počítají základ bez DPH z uložených položek, ne z hrubé ceny.
