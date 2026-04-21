/**
 * Pozyskanie ciasteczek przy użyciu TLS/HTTP fingerprintu Chrome 124 (JA3/JA4 przez wreq-js).
 */
import { createSession } from "wreq-js";
import type { Cookie } from "playwright";

/** User-Agent zsynchronizowany z profilem TLS `chrome_124` + Windows (jak w emulacji wreq). */
export const HYBRID_USER_AGENT_CHROME124 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Kształt rekordu z Session.getAllCookies() (SessionCookie nie jest eksportowany z pakietu). */
type WreqCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "lax" | "strict" | "none";
  expiresAtMs?: number;
};

function sameSitePlaywright(
  s?: string,
): "Strict" | "Lax" | "None" | undefined {
  if (!s) return undefined;
  const k = s.toLowerCase();
  if (k === "strict") return "Strict";
  if (k === "lax") return "Lax";
  if (k === "none") return "None";
  return undefined;
}

/** Mapowanie ciasteczek z sesji wreq → format Playwright `addCookies`. */
export function mapSessionCookiesToPlaywright(
  cookies: WreqCookie[],
  fallbackHost: string,
): Cookie[] {
  const out: Cookie[] = [];
  for (const c of cookies) {
    let domain = c.domain?.trim();
    if (!domain) domain = new URL(fallbackHost).hostname;
    if (!domain.startsWith(".")) domain = `.${domain}`;

    out.push({
      name: c.name,
      value: c.value,
      domain,
      path: c.path ?? "/",
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: sameSitePlaywright(c.sameSite) ?? "Lax",
      expires:
        c.expiresAtMs != null && c.expiresAtMs > 0
          ? Math.floor(c.expiresAtMs / 1000)
          : -1,
    });
  }
  return out;
}

export type ProtocolSession = {
  cookies: Cookie[];
  userAgent: string;
};

/**
 * Wykonuje żądanie(ia) jako Chrome 124 / Windows i zbiera ciasteczka sesji (m.in. pod `cf_clearance`, `csrftoken`).
 */
export async function fetchProtocolSession(
  entryUrl: string,
): Promise<ProtocolSession> {
  const session = await createSession({
    browser: "chrome_124",
    os: "windows",
    timeout: 120_000,
  });

  try {
    await session.fetch(entryUrl, {
      method: "GET",
      redirect: "follow",
    });

    const origin = new URL(entryUrl).origin;
    await session.fetch(origin + "/", {
      method: "GET",
      redirect: "follow",
    }).catch(() => {});

    const raw = session.getAllCookies() as WreqCookie[];
    const cookies = mapSessionCookiesToPlaywright(raw, entryUrl);

    return {
      cookies,
      userAgent: HYBRID_USER_AGENT_CHROME124,
    };
  } finally {
    await session.close();
  }
}
