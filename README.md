# Lotto Scraper

Skrypt w TypeScript pobiera **ostatnie wyniki wybranych gier liczbowych** ze strony [lotto.pl](https://www.lotto.pl) (domyślnie `/wyniki-gier`), używa **hybrydy TLS + Playwright**, a następnie zapisuje dane w bazie **MySQL**. Duplikaty dla tej samej pary **gra + data losowania** są pomijane.

## Stack technologiczny

| Warstwa | Technologie |
|--------|-------------|
| Język | **TypeScript** (ESM, `module: NodeNext`) |
| Uruchamianie | **tsx** — bez kompilacji do JS przy `npm start` |
| TLS / fingerprint | **wreq-js** — profil **Chrome 124** / Windows (żądania jak prawdziwa przeglądarka; ciasteczka m.in. `cf_clearance`, `csrftoken`) |
| Przeglądarka | **Playwright Chromium** — domyślnie **headless** (`HEADLESS=true`, `--headless=new`); przy **`HEADLESS=false`** widoczne okno (podgląd). Ten sam User-Agent co warstwa TLS, `context.addCookies()` przed wejściem na stronę |
| Turnstile (fallback) | **Capsolver** (`CAPSOLVER_API_KEY`) lub **2Captcha** (`TWOCAPTCHA_API_KEY`) — token zwracany do pola odpowiedzi Turnstile |
| UX pomocnicze | **playwright-ghost-cursor**, `human-input.ts` (`humanMoveAndClick`) — np. baner cookies |
| Konfiguracja | **dotenv** — zmienne z pliku `.env` |
| Lint | **ESLint** + **typescript-eslint** (`eslint.config.js`) |
| Baza | **mysql2** (pula, zapytania parametryzowane) |

Pakiet **puppeteer-real-browser** dotyczy ekosystemu Puppeteer/Xvfb; w tym projekcie **headless Chromium + dopasowany TLS/UA + solver API** spełniają podobną rolę dla Turnstile bez osobnego serwera graficznego.

## Wymagania wstępne

- **Node.js 20+**
- **MySQL** — utworzona baza i użytkownik z prawem zapisu
- Po `npm install` uruchamiane jest **`playwright install chromium`** (binaria Chromium dla Playwright). W CI można ustawić **`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`**, żeby pominąć pobieranie.

## Instalacja

```bash
npm install
```

Skopiuj konfigurację i uzupełnij wartości (`.env` w katalogu głównym):

```env
DB_HOST=localhost
DB_USER=lotto_user
DB_PASSWORD=twoje_haslo
DB_DATABASE=lotto

# HEADLESS=true — bez okna (domyślnie). HEADLESS=false — widoczna przeglądarka (podgląd).
HEADLESS=true

# Opcjonalnie — inna strona startowa (domyślnie https://www.lotto.pl/wyniki-gier)
# LOTTO_RESULTS_URL=https://www.lotto.pl/wyniki-gier

# Opcjonalnie — rozwiązanie Turnstile, gdy strona nadal pokazuje wyzwanie po sesji TLS
# CAPSOLVER_API_KEY=...
# TWOCAPTCHA_API_KEY=...
```

### Tworzenie bazy, użytkownika i uprawnień (konsola MySQL)

Po zalogowaniu się do serwera MySQL jako użytkownik z prawem administracyjnym (np. `root`), wykonaj polecenia w konsoli klienta (`mysql -u root -p` lub odpowiednik na Twoim systemie):

```sql
CREATE DATABASE IF NOT EXISTS lotto
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'lotto_user'@'localhost' IDENTIFIED BY 'twoje_bezpieczne_haslo';

GRANT ALL PRIVILEGES ON lotto.* TO 'lotto_user'@'localhost';

FLUSH PRIVILEGES;
```

Jeśli aplikacja łączy się z MySQL **spod innej maszyny** niż serwer bazy, zamiast `'lotto_user'@'localhost'` użyj np. `'lotto_user'@'%'` (lub konkretnego hosta) i dopasuj reguły zapory oraz `bind-address` w konfiguracji MySQL.

Hasło z `CREATE USER` / `IDENTIFIED BY` musi być **zgodne** z wartością `DB_PASSWORD` w pliku `.env`. Po zmianie hasła u istniejącego użytkownika można użyć: `ALTER USER 'lotto_user'@'localhost' IDENTIFIED BY 'nowe_haslo';`

Tabela `results` tworzy się automatycznie przy pierwszym uruchomieniu (`game_name`, `draw_date`, `numbers_json`, `created_at`, unikat na parze gra + data).

## Uruchomienie

```bash
npm start
```

Działa **w tle** (Chromium headless). W konsoli: kroki `[hybryda]`, ewentualnie `[turnstile]` / `[solver]`, oraz `[baza]` przy zapisie.

### Kompilacja TypeScript (opcjonalnie)

```bash
npm run lint        # ESLint
npm run typecheck   # weryfikacja typów
npm run build       # kompilacja do dist/
```

Pliki JS trafiają do katalogu `dist/` zgodnie z `tsconfig.json`.

### CI (GitHub Actions)

Workflow **CI** może ustawiać `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — wtedy instalacja przeglądarki w pipelinie jest pomijana; lokalnie uruchom `npx playwright install chromium` jeśli brakuje binariów.

## Struktura projektu (skrót)

| Plik | Opis |
|------|------|
| `index.ts` | Punkt wejścia — baza, scraping, zapis |
| `tls-session.ts` | Sesja **wreq-js** (Chrome 124), mapowanie ciastek do Playwright |
| `browser-session.ts` | `launchHeadlessWithSession()` — Chromium, cookies, UA |
| `turnstile-solver.ts` | Capsolver / 2Captcha dla Turnstile |
| `scraper.ts` | Łączenie hybrydy, `/wyniki-gier`, zbieranie danych |
| `human-input.ts` | `humanMoveAndClick` |
| `db.ts` | Pula MySQL, UPSERT |
| `types.ts` | Typ rekordu losowania |

## Uwagi

- Strona lotto.pl może zwracać **Cloudflare / Turnstile** — najpierw próba z ciasteczkami z TLS; jeśli wyzwanie zostaje, solver wymaga **klucza API** w `.env`.
- Wyniki mapowane są na wybrane gry (m.in. Lotto, Eurojackpot, Mini Lotto, Multi Multi, Kaskada, Ekstra Pensja); przy dużej zmianie frontu może być potrzebna aktualizacja ekstrakcji w `scraper.ts`.
