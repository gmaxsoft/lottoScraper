import { createInterface } from "node:readline";
import type { Page, Response } from "playwright";
import { Camoufox } from "camoufox-js";
import { createCursor } from "playwright-ghost-cursor";
import type { DrawRecord } from "./types.js";
import { humanMoveAndClick } from "./human-input.js";

function skipEnterPrompt(): boolean {
  return process.env.LOTTO_SKIP_ENTER_PROMPT === "1";
}

/** Gdy jest TTY: po rozwiązaniu weryfikacji użytkownik zatwierdza Enterem, że strona jest gotowa (Cloudflare często nie zmienia URL). */
function waitForEnterInTerminal(message: string): Promise<void> {
  if (skipEnterPrompt() || !process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

/** Nazwy wyświetlane na lotto.pl → klucz kanoniczny */
export const GAME_LABELS = [
  "Lotto",
  "Eurojackpot",
  "Mini Lotto",
  "Multi Multi",
  "Kaskada",
  "Ekstra Pensja",
] as const;

const CANONICAL_NAME: Record<string, string> = {
  lotto: "Lotto",
  eurojackpot: "Eurojackpot",
  minimulti: "Mini Lotto",
  minilotto: "Mini Lotto",
  "mini lotto": "Mini Lotto",
  multimulti: "Multi Multi",
  multi: "Multi Multi",
  "multi multi": "Multi Multi",
  kaskada: "Kaskada",
  ekstrapensja: "Ekstra Pensja",
  "ekstra pensja": "Ekstra Pensja",
};

function canonicalGameName(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (CANONICAL_NAME[k]) return CANONICAL_NAME[k];
  for (const g of GAME_LABELS) {
    if (g.toLowerCase() === k) return g;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Krótkie opóźnienie między ruchami myszy / scroll — nie zastępuje oczekiwania na sieć */
async function briefPause(minMs = 120, maxMs = 420): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  await sleep(ms);
}

async function randomIdleMouseAndScroll(page: Page): Promise<void> {
  const cursor = createCursor(page, undefined, false);
  const vp = page.viewportSize() ?? { width: 1920, height: 1080 };
  const passes = 3 + Math.floor(Math.random() * 4);

  for (let i = 0; i < passes; i++) {
    await cursor.moveTo(
      {
        x: 80 + Math.random() * (vp.width - 160),
        y: 80 + Math.random() * (vp.height - 160),
      },
      { moveSpeed: 20 + Math.random() * 40 },
    );
    await briefPause(200, 600);
    await cursor.scroll(
      { x: 0, y: 120 + Math.floor(Math.random() * 280) },
      { scrollSpeed: 25 + Math.floor(Math.random() * 35), scrollDelay: 280 },
    );
    await briefPause(300, 800);
    await cursor.scroll(
      { x: 0, y: -(80 + Math.floor(Math.random() * 220)) },
      { scrollSpeed: 20 + Math.floor(Math.random() * 30), scrollDelay: 220 },
    );
    await briefPause(150, 500);
  }
}

/**
 * Cloudflare Turnstile nie da się legalnie „zhackować” z poziomu skryptu — tutaj tylko wykrywanie i czekanie,
 * aż użytkownik dokończy weryfikację w przeglądarce (ev. Enter w terminalu).
 */
async function isHumanVerificationPresent(page: Page): Promise<boolean> {
  const iframeSelectors = [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'iframe[src*="cloudflare"]',
  ];
  for (const sel of iframeSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return true;
  }

  const textChecks = [
    page.getByText(/Potwierdź\s*,?\s*że jesteś człowiekiem/i).first(),
    page.getByText(/Verify you are human/i).first(),
    page.locator('[data-testid="challenge-stage"]').first(),
    page.locator(".cf-turnstile").first(),
  ];
  for (const loc of textChecks) {
    if (await loc.isVisible().catch(() => false)) return true;
  }

  return false;
}

/** W przeglądarce: brak typowego tekstu wyzwania ORAZ brak iframe Turnstile w DOM. */
async function waitUntilChallengeGoneInPage(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const body = document.body?.innerText ?? "";
      if (/Potwierdź\s*,?\s*że jesteś człowiekiem/i.test(body)) return false;
      if (/Verify you are human/i.test(body)) return false;
      const iframes = document.querySelectorAll(
        'iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"]',
      );
      return iframes.length === 0;
    },
    undefined,
    { timeout: 900_000 },
  );
}

async function waitForManualTurnstileResolution(page: Page): Promise<void> {
  if (!(await isHumanVerificationPresent(page))) return;

  const initialUrl = page.url();
  console.warn(
    "[turnstile] Wykryto Cloudflare (iframe i/lub tekst „Potwierdź, że jesteś człowiekiem”).",
  );
  console.warn(
    "[turnstile] Uzupełnij weryfikację w oknie Firefox (Camoufox). Nie da się tego pominąć skryptem — to ochrona przed botami.",
  );

  await waitForEnterInTerminal(
    "→ Gdy w przeglądarce zniknie komunikat i zobaczysz normalną stronę lotto.pl, wróć tutaj i naciśnij Enter, żeby kontynuować.\n" +
      "   (W CI / bez TTY ten krok jest pomijany; ustaw LOTTO_SKIP_ENTER_PROMPT=1 aby wyłączyć pytanie o Enter.)\n",
  );

  await Promise.race([
    page.waitForURL((u) => u.href !== initialUrl, { timeout: 900_000 }),
    waitUntilChallengeGoneInPage(page),
  ]).catch(() => {});

  await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
}

async function acceptCookies(page: Page): Promise<void> {
  const idSelectors = [
    "#onetrust-accept-btn-handler",
    'button[id="onetrust-accept-btn-handler"]',
    "#accept-recommended-btn-handler",
  ];
  for (const sel of idSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 8000 });
      await humanMoveAndClick(page, sel, { waitForSelectorMs: 8000 });
      await briefPause(400, 900);
      return;
    } catch {
      /* próbuj dalej */
    }
  }

  const cursor = createCursor(page, undefined, false);
  const textButtons = [
    page.getByRole("button", { name: /zgadzam się/i }),
    page.getByRole("button", { name: /zaakceptuj wszystkie/i }),
  ];
  for (const loc of textButtons) {
    try {
      const first = loc.first();
      if (await first.isVisible({ timeout: 2000 }).catch(() => false)) {
        await first.scrollIntoViewIfNeeded();
        await briefPause();
        const h = await first.elementHandle();
        if (h) await cursor.click(h);
        await briefPause(400, 800);
        return;
      }
    } catch {
      /* następny */
    }
  }
}

function parsePolishDateFragment(text: string): string | null {
  const dmy = text.match(/\b(\d{1,2})[.](\d{1,2})[.](\d{4})\b/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const ymd = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  return null;
}

function normalizeNumbers(val: unknown): number[] {
  if (val === null || val === undefined) return [];
  if (typeof val === "number" && Number.isFinite(val)) return [val];
  if (Array.isArray(val)) {
    const out: number[] = [];
    for (const item of val) {
      if (typeof item === "number" && Number.isFinite(item)) out.push(item);
      else if (typeof item === "string" && /^\d{1,2}$/.test(item.trim()))
        out.push(parseInt(item.trim(), 10));
      else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const candidates = ["number", "value", "digit", "numer"];
        for (const k of candidates) {
          if (rec[k] !== undefined) {
            const n = Number(rec[k]);
            if (Number.isFinite(n)) out.push(n);
          }
        }
      }
    }
    return out.filter((n) => n >= 0 && n <= 99);
  }
  return [];
}

function extractFromUnknownJson(root: unknown): DrawRecord[] {
  const found: DrawRecord[] = [];

  function visit(node: unknown, depth: number): void {
    if (depth > 24 || node === null || node === undefined) return;
    if (typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const el of node) visit(el, depth + 1);
      return;
    }

    const o = node as Record<string, unknown>;
    const keys = Object.keys(o);

    const gameKey = keys.find((k) =>
      /^(gameType|game|lotteryType|lottery|type|name)$/i.test(k),
    );
    const dateKey = keys.find((k) =>
      /^(drawDate|draw_date|date|drawingDate|lotteryDate)$/i.test(k),
    );
    const numsKey = keys.find((k) =>
      /^(numbers|results|winningNumbers|wyniki|regularNumbers|mainNumbers)$/i.test(
        k,
      ),
    );

    if (gameKey && dateKey && numsKey) {
      const gRaw = String(o[gameKey] ?? "");
      const gameName = canonicalGameName(gRaw);
      const dateRaw = String(o[dateKey] ?? "");
      const parsedDate =
        parsePolishDateFragment(dateRaw) ??
        (/\d{4}-\d{2}-\d{2}/.exec(dateRaw)?.[0] ?? null);
      let nums = normalizeNumbers(o[numsKey]);
      const extraKey = keys.find((k) =>
        /^(euroNumbers|additionalNumbers|extraNumbers)$/i.test(k),
      );
      if (extraKey) nums = [...nums, ...normalizeNumbers(o[extraKey])];

      if (gameName && parsedDate && nums.length > 0) {
        found.push({
          gameName,
          drawDate: parsedDate,
          numbers: [...new Set(nums)].sort((a, b) => a - b),
        });
      }
    }

    for (const k of keys) visit(o[k], depth + 1);
  }

  visit(root, 0);
  return dedupeRecords(found);
}

function dedupeRecords(rows: DrawRecord[]): DrawRecord[] {
  const map = new Map<string, DrawRecord>();
  for (const r of rows) {
    const key = `${r.gameName}|${r.drawDate}`;
    if (!map.has(key)) map.set(key, r);
  }
  return [...map.values()];
}

async function tryParseResponseJson(res: Response): Promise<unknown | null> {
  try {
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("application/json")) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function extractFromDomEvaluate(): DrawRecord[] {
  const labels = [
    "Mini Lotto",
    "Multi Multi",
    "Eurojackpot",
    "Ekstra Pensja",
    "Kaskada",
    "Lotto",
  ];
  const results: DrawRecord[] = [];

  function numsFromText(block: string): number[] {
    const matches = block.match(/\b\d{1,2}\b/g);
    if (!matches) return [];
    const nums = matches
      .map((m) => parseInt(m, 10))
      .filter((n) => n >= 1 && n <= 99);
    return [...new Set(nums)].slice(0, 32);
  }

  for (const label of labels) {
    const xpath = `//*[not(self::script)][not(self::style)][contains(normalize-space(.), '${label}')]`;
    const snap = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    for (let i = 0; i < snap.snapshotLength; i++) {
      const node = snap.snapshotItem(i);
      if (!node || !(node instanceof Element)) continue;
      let block: Element | null = node.closest(
        "article, [class*='result'], [class*='Result'], [class*='draw'], [class*='card'], section, a",
      );
      if (!block) block = node.parentElement;
      if (!block) continue;
      const text =
        (block as HTMLElement).innerText?.trim() ||
        block.textContent?.trim() ||
        "";
      if (text.length < 10 || text.length > 8000) continue;
      const date =
        parsePolishDateFragment(text) ??
        (/\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? null);
      const nums = numsFromText(text);
      if (!date || nums.length < 2) continue;
      results.push({
        gameName: label,
        drawDate: date,
        numbers: nums,
      });
      break;
    }
  }

  return dedupeRecords(results);
}

/** Czeka na zniknięcie typowych tytułów strony pośredniej Cloudflare (Playwright: 3. argument = opcje, nie 2.). */
async function waitPastCloudflareTitle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const t = document.title.toLowerCase();
      return (
        !t.includes("cierpliwości") &&
        !t.includes("just a moment") &&
        !t.includes("checking your browser") &&
        !t.includes("attention required")
      );
    },
    undefined,
    { timeout: 180_000 },
  );
}

export async function scrapeLatestDraws(): Promise<DrawRecord[]> {
  const capturedJson: unknown[] = [];

  /* Firefox Camoufox — stealth na poziomie silnika (bez Chromium / bez flag typu --disable-blink-features). */
  const browser = await Camoufox({
    headless: false,
    locale: ["pl-PL"],
    window: [1920, 1080],
    humanize: true,
    os: "windows",
  });

  try {
    const context = await browser.newContext({
      locale: "pl-PL",
      timezoneId: "Europe/Warsaw",
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
    });

    const page = await context.newPage();

    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (!/lotto\.pl/i.test(url)) return;
        if (res.status() !== 200) return;
        if (
          !/json|draw|wynik|lotter|result/i.test(url) &&
          !(res.headers()["content-type"] ?? "").includes("json")
        )
          return;
        const json = await tryParseResponseJson(res);
        if (json !== null) capturedJson.push(json);
      } catch {
        /* ignoruj pojedyncze błędy parsowania */
      }
    });

    await page.goto("https://www.lotto.pl/", {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });

    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});

    /** Turnstile („Potwierdź…”) przed sprawdzaniem samego tytułu — użytkownik może rozwiązać captcha wcześniej. */
    await waitForManualTurnstileResolution(page);

    try {
      await waitPastCloudflareTitle(page);
    } catch (e) {
      console.warn(
        "[cloudflare] Tytuł strony pośredniej nie zniknął w czasie — kontynuacja (np. inna wersja językowa).",
        e,
      );
    }

    await randomIdleMouseAndScroll(page);

    await acceptCookies(page);

    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
    await briefPause(400, 900);

    let fromApi: DrawRecord[] = [];
    for (const chunk of capturedJson) {
      fromApi = fromApi.concat(extractFromUnknownJson(chunk));
    }
    fromApi = dedupeRecords(fromApi);

    let fromDom = await page.evaluate(extractFromDomEvaluate);
    fromDom = dedupeRecords(fromDom);

    const merged = dedupeRecords([...fromApi, ...fromDom]);

    const wanted = new Set<string>(GAME_LABELS as unknown as string[]);
    const filtered = merged.filter((r) => wanted.has(r.gameName));

    if (filtered.length === 0 && merged.length > 0) {
      return merged;
    }
    return filtered.length > 0 ? filtered : merged;
  } finally {
    await browser.close();
  }
}
