# Lotto Scraper

Skrypt w TypeScript pobiera **ostatnie wyniki wybranych gier liczbowych** ze strony [lotto.pl](https://www.lotto.pl) (**Firefox Camoufox** przez Playwright), a następnie zapisuje je w bazie **MySQL**. Duplikaty dla tej samej pary **gra + data losowania** są pomijane.

## Stack technologiczny

| Warstwa | Technologie |
|--------|-------------|
| Język | **TypeScript** (ESM, `module: NodeNext`) |
| Uruchamianie | **tsx** — bez kompilacji do JS przy `npm start` |
| Przeglądarka / automatyzacja | **Playwright** + **camoufox-js** (Firefox Camoufox — utwardzony profil na poziomie silnika), **playwright-ghost-cursor** (ruchy myszy), moduł `human-input.ts` z **`humanMoveAndClick()`** (pakiety o nazwie *playwright-human-input* w npm nie ma — używany jest odpowiednik *playwright-ghost-cursor*) |
| Konfiguracja | **dotenv** — zmienne środowiskowe z pliku `.env` |
| Lint | **ESLint** + **typescript-eslint** — konfiguracja płaska (`eslint.config.js`) |
| Baza danych | **mysql2** (pulę połączeń, zapytania parametryzowane) |

## Wymagania wstępne

- **Node.js 20+** (wymóg **camoufox-js**)
- **MySQL** — utworzona baza danych i użytkownik z prawem zapisu
- Po `npm install` uruchamiane jest **`camoufox-js fetch`** — pobranie binariów Camoufox (chyba że ustawione jest `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, jak w CI)

## Instalacja

```bash
npm install
```

Skopiuj konfigurację bazy i uzupełnij wartości (plik `.env` w katalogu głównym projektu):

```env
DB_HOST=localhost
DB_USER=lotto_user
DB_PASSWORD=twoje_haslo
DB_DATABASE=lotto
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

Uruchamiany jest **Camoufox** w trybie **widocznym** (`headless: false`). Przy **Cloudflare Turnstile** (interaktywne „Potwierdź, że jesteś człowiekiem”) rozwiązanie odbywa się **ręcznie** w oknie przeglądarki — skrypt czeka na dalsze ładowanie strony. W konsoli pojawiają się m.in. wpisy `[baza]` — jakie liczby trafiają do MySQL oraz czy rekord został zapisany, czy pominięty jako duplikat.

### Kompilacja TypeScript (opcjonalnie)

```bash
npm run lint        # ESLint — pliki `.ts` w projekcie
npm run typecheck   # sama weryfikacja typów (bez zapisu do dist/)
npm run build       # kompilacja do katalogu dist/
```

Pliki JS trafiają do katalogu `dist/` zgodnie z `tsconfig.json`.

### CI (GitHub Actions)

Po każdym pushu lub pull requeście do gałęzi `main` / `master` uruchamiany jest workflow **CI** (`.github/workflows/ci.yml`): instalacja zależności (`npm ci`), `npm run typecheck`, `npm run lint` oraz `npm run build`. Przeglądarka Playwright **nie jest** pobierana w pipelinie (ustawione `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

## Struktura projektu (skrót)

| Plik | Opis |
|------|------|
| `index.ts` | Punkt wejścia — połączenie z bazą, scraping, zapis |
| `scraper.ts` | Camoufox, cookies (humanMoveAndClick), Turnstile, zbieranie danych |
| `human-input.ts` | `humanMoveAndClick` — wrapper na playwright-ghost-cursor |
| `db.ts` | Pula MySQL, tworzenie tabeli, UPSERT |
| `types.ts` | Typ rekordu losowania |

## Uwagi

- Po **aktualizacji Node.js** komunikat `better-sqlite3` / `NODE_MODULE_VERSION` / `was compiled against a different Node.js version`: uruchom w katalogu projektu **`npm rebuild better-sqlite3`** (albo **`rm -rf node_modules`**, potem **`npm install`**). Pakiet jest używany przez **camoufox-js** (natywny addon musi pasować do ABI Twojej wersji Node).
- **`LOTTO_SKIP_ENTER_PROMPT=1`** — przy Cloudflare Turnstile skrypt może oczekiwać na **Enter** w terminalu po ręcznym przejściu weryfikacji; ustaw tę zmienną (np. w `.env`), jeśli nie masz interaktywnego terminala lub chcesz tylko pasywne oczekiwanie (bez znaku akceptacji Enterem).
- Strona lotto.pl może przez chwilę wyświetlać stronę oczekiwania lub **Turnstile** — skrypt używa `networkidle` i oczekuje na przejście dalej (w tym na zmianę URL lub zniknięcie iframe po ręcznym rozwiązaniu wyzwania).
- Wyniki są mapowane na wybrane gry (m.in. Lotto, Eurojackpot, Mini Lotto, Multi Multi, Kaskada, Ekstra Pensja); przy zmianie HTML/CSS na lotto.pl może być konieczna aktualizacja selektorów w `scraper.ts`.
