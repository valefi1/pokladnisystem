# v1.13 - pokladna: slevy, vážené položky, účty a světlý kontrast

## Změny

- Hotovostní platba se zaokrouhluje na celé koruny.
- Pokladna je vynuceně ve světlém režimu a produkty mají kontrastnější dlaždice.
- Vážené položky (`kg`) při kliknutí otevřou dotykové okno pro zadání množství.
- Položky v aktivním účtu lze upravovat: množství, cenu, slevu v Kč nebo %.
- Přidána sleva na celý nákup v Kč nebo %.
- V účtu už se nezobrazuje stav skladu po prodeji.
- Levý sloupec jde sbalit/rozbalit; stav se ukládá v prohlížeči.
- Lišta otevřených účtů je zvýrazněná a sticky nahoře v pokladně.
- Zaparkované účty dál zůstávají sdílené přes Supabase.

## Poznámky

- Nebyla potřeba nová Supabase migrace. Nové údaje o slevách jsou uložené v JSON `payload` existujících tabulek.
- Build ověřen příkazem `npm run build`.
