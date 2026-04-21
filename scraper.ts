import type { Page, Response } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { DrawRecord } from "./types.js";

chromium.use(StealthPlugin());

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

export async function humanDelay(minMs = 250, maxMs = 900): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  await sleep(ms);
}

async function humanClick(page: Page, selector: string): Promise<boolean> {
  const loc = page.locator(selector).first();
  const count = await loc.count();
  if (!count) return false;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await humanDelay(120, 450);
  const box = await loc.boundingBox();
  if (box) {
    await page.mouse.move(
      box.x + box.width / 2 + (Math.random() * 10 - 5),
      box.y + box.height / 2 + (Math.random() * 10 - 5),
      { steps: 12 + Math.floor(Math.random() * 10) },
    );
  }
  await humanDelay(150, 550);
  await loc.click({ delay: 40 + Math.floor(Math.random() * 90) });
  return true;
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

/** Rekursywne szukanie obiektów przypominających rekord losowania w JSON z API */
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

/** Heurystyczny parsing bloku tekstu z karty wyniku na stronie */
function extractFromDomEvaluate(): DrawRecord[] {
  /* Dłuższe nazwy najpierw — „Lotto” występuje wewnątrz „Mini Lotto”. */
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

async function acceptCookies(page: Page): Promise<void> {
  const selectors = [
    "#onetrust-accept-btn-handler",
    'button[id="onetrust-accept-btn-handler"]',
    "#accept-recommended-btn-handler",
  ];
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 8000 });
      await humanClick(page, sel);
      await humanDelay(400, 900);
      return;
    } catch {
      /* próbuj dalej */
    }
  }
  const textButtons = [
    page.getByRole("button", { name: /zgadzam się/i }),
    page.getByRole("button", { name: /zaakceptuj wszystkie/i }),
    page.getByText(/zaakceptuj wszystkie/i),
    page.getByText(/zgadzam się/i),
  ];
  for (const loc of textButtons) {
    try {
      const first = loc.first();
      if (await first.isVisible({ timeout: 2000 })) {
        await first.scrollIntoViewIfNeeded();
        await humanDelay();
        await first.click({ delay: 60 });
        await humanDelay(400, 800);
        return;
      }
    } catch {
      /* następny */
    }
  }
}

async function waitPastCloudflare(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const t = document.title.toLowerCase();
      return !t.includes("cierpliwości") && !t.includes("just a moment");
    },
    { timeout: 180_000 },
  );
}

export async function scrapeLatestDraws(): Promise<DrawRecord[]> {
  const capturedJson: unknown[] = [];

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "pl-PL",
      timezoneId: "Europe/Warsaw",
      viewport: { width: 1366, height: 900 },
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

    await waitPastCloudflare(page);
    await humanDelay(600, 1400);

    await acceptCookies(page);
    await humanDelay(500, 1100);

    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => {});
    await humanDelay(800, 1600);

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
