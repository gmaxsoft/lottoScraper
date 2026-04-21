# Lotto Scraper

Skrypt w TypeScript pobiera **ostatnie wyniki wybranych gier liczbowych** ze strony [lotto.pl](https://www.lotto.pl) (przeglądarka Playwright), a następnie zapisuje je w bazie **MySQL**. Duplikaty dla tej samej pary **gra + data losowania** są pomijane.

## Stack technologiczny

| Warstwa | Technologie |
|--------|-------------|
| Język | **TypeScript** (ESM, `module: NodeNext`) |
| Uruchamianie | **tsx** — bez kompilacji do JS przy `npm start` |
| Przeglądarka / automatyzacja | **Playwright** (Chromium), **playwright-extra** + **puppeteer-extra-plugin-stealth** (mniejsza widoczność automatyzacji; ochrona przed typowym wykrywaniem „botów”) |
| Konfiguracja | **dotenv** — zmienne środowiskowe z pliku `.env` |
| Lint | **ESLint** + **typescript-eslint** — konfiguracja płaska (`eslint.config.js`) |
| Baza danych | **mysql2** (pulę połączeń, zapytania parametryzowane) |

Uwaga: pakiet **`playwright-stealth`** w npm jest **placeholderem** bez działającej logiki; faktyczny plugin stealth użyty w projekcie to **puppeteer-extra-plugin-stealth** w połączeniu z **playwright-extra**.

## Wymagania wstępne

- **Node.js** (LTS zalecany)
- **MySQL** — utworzona baza danych i użytkownik z prawem zapisu
- Po `npm install` pobierany jest **Chromium** dla Playwright (`postinstall`)

## Instalacja

```bash
npm install
```

Skopiuj konfigurację bazy i uzupełnij wartości (plik `.env` w katalogu głównym projektu):

```env
DB_HOST=localhost
DB_USER=twoj_uzytkownik
DB_PASSWORD=twoje_haslo
DB_DATABASE=nazwa_bazy
```

Tabela `results` tworzy się automatycznie przy pierwszym uruchomieniu (`game_name`, `draw_date`, `numbers_json`, `created_at`, unikat na parze gra + data).

## Uruchomienie

```bash
npm start
```

Skrypt uruchamia Chromium w trybie **widocznym** (`headless: false`), aby ułatwić przejście ewentualnej weryfikacji (np. Cloudflare). W konsoli pojawiają się m.in. wpisy `[baza]` — jakie liczby trafiają do MySQL oraz czy rekord został zapisany, czy pominięty jako duplikat.

### Kompilacja TypeScript (opcjonalnie)

```bash
npm run lint        # ESLint — pliki *.ts w katalogu głównym
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
| `scraper.ts` | Uruchomienie przeglądarki, cookies, zbieranie danych z sieci/DOM |
| `db.ts` | Pula MySQL, tworzenie tabeli, UPSERT |
| `types.ts` | Typ rekordu losowania |

## Uwagi

- Strona lotto.pl może przez chwilę wyświetlać stronę oczekiwania — skrypt czeka na załadowanie treści głównej.
- Wyniki są mapowane na wybrane gry (m.in. Lotto, Eurojackpot, Mini Lotto, Multi Multi, Kaskada, Ekstra Pensja); przy zmianie HTML/CSS na lotto.pl może być konieczna aktualizacja selektorów w `scraper.ts`.
