import {
  chromium,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from "playwright";

export type HeadlessSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

/** Zmienna `HEADLESS` z `.env`: true = bez okna, false = podgląd przeglądarki. Domyślnie headless. */
export function resolveHeadlessFromEnv(): boolean {
  const raw = process.env.HEADLESS?.trim().toLowerCase();
  if (!raw) return true;
  if (["false", "0", "no", "off", "nie"].includes(raw)) return false;
  if (["true", "1", "yes", "on", "tak"].includes(raw)) return true;
  console.warn(
    `[browser] Nieznana wartość HEADLESS="${process.env.HEADLESS}" — używam trybu headless.`,
  );
  return true;
}

const commonLaunchArgs = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-dev-shm-usage",
] as const;

/**
 * Uruchamia Chromium (headless lub z oknem wg `HEADLESS` w `.env`) i wstrzykuje ciasteczka z warstwy protokołowej (oraz ten sam UA co w wreq).
 */
export async function launchHeadlessWithSession(
  cookies: Cookie[],
  userAgent: string,
): Promise<HeadlessSession> {
  const headless = resolveHeadlessFromEnv();
  const launchArgs = headless
    ? ["--headless=new", ...commonLaunchArgs]
    : [...commonLaunchArgs];

  if (!headless) {
    console.log("[browser] HEADLESS=false — uruchamiam Chromium z widocznym oknem (podgląd).");
  }

  const browser = await chromium.launch({
    headless,
    args: launchArgs,
  });

  const context = await browser.newContext({
    userAgent,
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  const page = await context.newPage();
  return { browser, context, page };
}
