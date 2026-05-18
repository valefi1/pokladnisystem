# v1.19 – kategorie a řazení produktů

- Produkty v katalogu lze filtrovat podle kategorie přes rozbalovací menu.
- Přidán panel "Pořadí dlaždic v pokladně" pro ruční řazení produktů v rámci kategorie.
- Ruční pořadí se ukládá do produktu jako `displayOrder` a synchronizuje se přes Supabase v JSON payloadu.
- Pokladna při řazení produktů respektuje uživatelské pořadí v rámci kategorie.
- Horní kategorie v pokladně mají čistší design bez viditelného horizontálního scrollbaru.
- Tlačítko "Všechny kategorie" je vizuálně sjednocené s pokladním režimem.

Není potřeba spouštět novou Supabase migraci.
