import "dotenv/config";
import {
  ensureResultsTable,
  pool,
  testConnection,
  upsertDrawRecords,
} from "./db.js";
import { scrapeLatestDraws } from "./scraper.js";

async function main(): Promise<void> {
  await testConnection();
  await ensureResultsTable();

  console.log(
    "Pobieranie wyników z lotto.pl — uruchamiany jest Firefox Camoufox (widoczne okno).",
  );
  console.log(
    "Jeśli pojawi się Cloudflare Turnstile: rozwiąż wyzwanie ręcznie w przeglądarce; skrypt poczeka na przejście dalej.",
  );

  const draws = await scrapeLatestDraws();

  if (draws.length === 0) {
    console.warn(
      "Nie znaleziono rekordów wyników. Sprawdź połączenie lub selektory strony.",
    );
    return;
  }

  console.log(
    `Przygotowano ${draws.length} rekordów do zapisu (szczegóły przy każdej operacji [baza]):`,
  );

  const inserted = await upsertDrawRecords(draws);
  console.log(
    `Podsumowanie: ${inserted} nowych wierszy w bazie, ${draws.length - inserted} pominiętych jako duplikaty (ta sama gra + data).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
