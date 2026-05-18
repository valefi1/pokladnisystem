# Android tisk a Dotypay terminál

## Tisk účtenek na Androidu

Webová aplikace v prohlížeči neumí spolehlivě tisknout na termální ESC/POS tiskárnu potichu bez systémového dialogu. Proto je automatický tisk v této verzi výchozí vypnutý.

Po dokončení prodeje se v pravém panelu zobrazí velké dotykové tlačítko **Vytisknout účtenku**. Systémový tisk Androidu se spustí pouze po klepnutí obsluhy.

Pro skutečný tichý tisk bez dialogu jsou realistické varianty:

1. **Android native bridge / Capacitor APK** - webová pokladna běží v Android aplikaci a nativní plugin posílá ESC/POS příkazy na USB/Bluetooth/LAN tiskárnu.
2. **Externí tisková aplikace / print service** - web předá tisk Android systému, ale výběr tiskárny řeší tisková služba.
3. **Terminál s integrovanou tiskárnou** - pokud poběží nativní aplikace přímo na Dotypay/NEXGO zařízení, může nativní vrstva obsloužit tiskárnu zařízení.

## Dotypay integrace

Aktuální kód má připravený režim Dotypay LIVE přes Nexo HTTP protokol:

- POS / pokladna je klient.
- Terminál / POI je server.
- Komunikace je HTTP POST na `http://<IP_TERMINALU>:7500/`.
- Tělo požadavku je Nexo JSON (`SaleToPOIRequest`).
- Požadavek vyžaduje `Authorization: Bearer <token>`.

Důležité omezení webové verze na Vercelu:

- Vercel aplikace běží přes HTTPS.
- Prohlížeč na Androidu typicky zablokuje volání z HTTPS stránky na lokální `http://192.168.x.x:7500` kvůli mixed content / bezpečnostním pravidlům.
- Terminál navíc musí povolit komunikaci z prohlížeče z pohledu CORS.

Proto je pro reálný provoz s terminálem nejlepší jeden z těchto přístupů:

1. **Nativní Android wrapper**: React aplikace se zabalí do APK přes Capacitor. Platby na terminál posílá nativní HTTP plugin, ne browser `fetch`.
2. **Lokální bridge v síti**: malé zařízení/služba v provozovně přijme požadavek z pokladny a komunikuje s terminálem v LAN. Musí být bezpečně řešená autorizace.
3. **Dotypay certifikovaná integrace**: projít integračním procesem, získat bearer token a mock zařízení, otestovat předepsané scénáře.

## Doporučený testovací postup

1. V aplikaci otevři **Zařízení**.
2. Nastav `Režim terminálu` na `Dotypay simulace / debug`.
3. Otestuj scénáře `Schváleno`, `Zamítnuto`, `Timeout`, `Zrušeno`.
4. Udělej testovací karetní platbu v pokladně a zkontroluj debug log.
5. Po získání tokenu od Dotypay přepni na `Dotypay LIVE`.
6. Vyplň IP adresu terminálu, Bearer token, Sale ID a timeout.
7. Spusť `Test připojení`.
8. Pokud běžíš ve webovém prohlížeči z Vercelu a test selže s chybou síťového spojení, nejde pravděpodobně o chybu aplikace, ale o omezení browseru vůči lokálnímu HTTP terminálu.
9. Pro ostré testy použij nativní Android wrapper nebo lokální bridge.

## Poznámka k IP adrese

Terminál a pokladna musí být ve stejné síti. Doporučuje se rezervovat terminálu pevnou IP adresu v routeru, aby se po restartu nezměnila.
