import type { Page } from "playwright";

/** Wyłuskanie site key Turnstile z DOM / iframe. */
export async function extractTurnstileSiteKey(page: Page): Promise<string | null> {
  const fromAttr = await page
    .locator("[data-sitekey]")
    .first()
    .getAttribute("data-sitekey")
    .catch(() => null);
  if (fromAttr) return fromAttr.trim();

  return page.evaluate(() => {
    const el = document.querySelector("[data-sitekey]") as HTMLElement | null;
    if (el?.getAttribute("data-sitekey"))
      return el.getAttribute("data-sitekey")!.trim();
    const iframes = document.querySelectorAll(
      'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]',
    );
    for (const fr of iframes) {
      const src = fr.getAttribute("src") ?? "";
      const m = /[?&]k=([^&]+)/.exec(src);
      if (m) return decodeURIComponent(m[1]!);
    }
    return null;
  });
}

/**
 * Capsolver: AntiTurnstileTaskProxyLess → token; wstrzyknięcie w ukryte pole (best-effort).
 * Wymaga CAPSOLVER_API_KEY w środowisku.
 */
export async function trySolveTurnstileCapsolver(
  page: Page,
  pageUrl: string,
): Promise<boolean> {
  const apiKey = process.env.CAPSOLVER_API_KEY?.trim();
  if (!apiKey) return false;

  const websiteKey = await extractTurnstileSiteKey(page);
  if (!websiteKey) {
    console.warn("[solver] Brak site key Turnstile w DOM — Capsolver pominięty.");
    return false;
  }

  console.warn("[solver] Wysyłanie zadania AntiTurnstileTaskProxyLess do Capsolver…");

  const createRes = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "AntiTurnstileTaskProxyLess",
        websiteURL: pageUrl,
        websiteKey,
      },
    }),
  });

  const created = (await createRes.json()) as {
    errorId?: number;
    taskId?: string;
    errorDescription?: string;
  };
  if (created.errorId || !created.taskId) {
    console.warn("[solver] Capsolver createTask:", created);
    return false;
  }

  const deadline = Date.now() + 180_000;
  let token: string | undefined;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: apiKey,
        taskId: created.taskId,
      }),
    });
    const result = (await poll.json()) as {
      status?: string;
      solution?: { token?: string; gRecaptchaResponse?: string };
      errorDescription?: string;
    };
    if (result.status === "ready") {
      token =
        result.solution?.token ?? result.solution?.gRecaptchaResponse ?? undefined;
      break;
    }
    if (result.status === "failed") {
      console.warn("[solver] Capsolver:", result.errorDescription ?? result);
      return false;
    }
  }

  if (!token) {
    console.warn("[solver] Capsolver: brak tokena w czasie.");
    return false;
  }

  await page.evaluate((t) => {
    const sel =
      'textarea[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"]';
    for (const el of document.querySelectorAll(sel)) {
      (el as HTMLTextAreaElement).value = t;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const win = window as unknown as {
      turnstile?: { reset?: (s: string) => void };
      onTurnstileSuccess?: (t: string) => void;
    };
    if (typeof win.onTurnstileSuccess === "function") {
      win.onTurnstileSuccess(t);
    }
  }, token);

  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  return true;
}

/**
 * 2Captcha Turnstile (userrecaptcha z action) — fallback gdy CAPSOLVER nie ustawiony.
 * Wymaga TWOCAPTCHA_API_KEY oraz metody zwracającej token (API v2).
 */
export async function trySolveTurnstile2Captcha(
  page: Page,
  pageUrl: string,
): Promise<boolean> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY?.trim();
  if (!apiKey) return false;

  const websiteKey = await extractTurnstileSiteKey(page);
  if (!websiteKey) return false;

  console.warn("[solver] Wysyłanie Turnstile do 2Captcha…");

  const inRes = await fetch(
    `https://2captcha.com/in.php?key=${encodeURIComponent(apiKey)}&method=turnstile&sitekey=${encodeURIComponent(websiteKey)}&pageurl=${encodeURIComponent(pageUrl)}&json=1`,
  );
  const inJson = (await inRes.json()) as { status?: number; request?: string };
  if (inJson.status !== 1 || !inJson.request) {
    console.warn("[solver] 2Captcha in.php:", inJson);
    return false;
  }

  const id = inJson.request;
  const deadline = Date.now() + 180_000;
  let token: string | undefined;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(id)}&json=1`,
    );
    const out = (await res.json()) as { status?: number; request?: string };
    if (out.status === 1 && out.request) {
      token = out.request;
      break;
    }
    if (out.request === "CAPCHA_NOT_READY") continue;
    console.warn("[solver] 2Captcha res:", out);
    return false;
  }

  if (!token) return false;

  await page.evaluate((t) => {
    for (const el of document.querySelectorAll(
      'textarea[name="cf-turnstile-response"], textarea[name="g-recaptcha-response"]',
    )) {
      (el as HTMLTextAreaElement).value = t;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, token);

  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  return true;
}

export async function trySolveTurnstileAny(
  page: Page,
  pageUrl: string,
): Promise<boolean> {
  if (await trySolveTurnstileCapsolver(page, pageUrl)) return true;
  if (await trySolveTurnstile2Captcha(page, pageUrl)) return true;
  return false;
}
