# Nasazení POS na GitHub + Supabase + Vercel

## 1) Supabase

1. V Supabase vytvoř nový projekt.
2. Otevři SQL Editor a spusť `supabase/schema.sql`.
3. V Authentication ponech e-mail/heslo zapnuté. Po nasazení se v aplikaci vytvoří/přihlásí účet.
4. Z Project Settings > API zkopíruj Project URL a publishable/anon key.

## 2) Lokální `.env.local`

```bash
cp .env.example .env.local
```

Doplň:

```env
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Bez těchto proměnných aplikace funguje dál lokálně přes prohlížeč.

## 3) Vercel

1. Nahraj projekt na GitHub.
2. Ve Vercelu importuj repo.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Do Environment Variables přidej stejné `VITE_SUPABASE_URL` a `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Co je nově ukládané do Supabase

- produkty,
- prodeje,
- skladové pohyby,
- pohybová historie,
- dodavatelé,
- příjemky,
- audit log,
- denní uzávěrky,
- importní metadata a koncept naskladnění.

Data se pořád ukládají i lokálně jako rychlá záloha/cache. Supabase je aktivní jen po nastavení env proměnných a přihlášení.

## Pokladní směny: otevření a zavření pokladny

Verze 1.8 přidává denní práci s hotovostí:

1. Před prvním prodejem otevři pokladnu v části **Pokladna** nebo **Tržby a přehledy**.
2. Zadej fyzicky spočítanou počáteční hotovost v kase.
3. Prodeje jsou přiřazené k aktuální otevřené pokladní směně.
4. Na konci dne otevři **Tržby a přehledy → Zavřít pokladnu / Z-report**.
5. Zadej fyzicky spočítanou hotovost v kase.
6. Systém porovná očekávaný stav: počáteční hotovost + hotovostní prodeje, včetně hotovostní části rozdělených plateb.
7. Výsledkem je rozdíl: 0 Kč = sedí, záporná částka = manko, kladná částka = přebytek.

Supabase tabulka pro tyto směny je `pos_cash_sessions`. Pokud už máš spuštěné starší schéma, spusť znovu `supabase/schema.sql`, nebo ručně doplň část s `pos_cash_sessions`.

## Hotovost po nominálech

Od verze 1.9 se pokladna otevírá a zavírá přes přepočet hotovosti po nominálech:

- bankovky: 5 000, 2 000, 1 000, 500, 200, 100 Kč,
- mince: 50, 20, 10, 5, 2, 1 Kč.

Při otevření systém spočítá celkovou hotovost podle zadaných kusů a porovná ji s posledním zavřením pokladny. Při zavření spočítá fyzickou hotovost podle zadaných kusů a porovná ji s očekávanou hotovostí:

```text
očekávaná hotovost = počáteční hotovost + hotovostní prodeje + hotovostní části rozdělených plateb
rozdíl = fyzicky spočítaná hotovost - očekávaná hotovost
```

Když už máš spuštěné Supabase schéma ze starší verze, znovu spusť `supabase/schema.sql`. Skript obsahuje `alter table ... add column if not exists`, takže doplní nové sloupce pro rozpis bankovek/mincí bez mazání stávajících dat.
