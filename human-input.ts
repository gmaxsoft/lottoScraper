/**
 * Pakiet `playwright-human-input` nie istnieje w rejestrze npm — zamiast niego
 * używane jest `playwright-ghost-cursor` (krzywe Beziera, naturalne ruchy myszy).
 */
import { createCursor } from "playwright-ghost-cursor";
import type { Page } from "playwright";

export async function humanMoveAndClick(
  page: Page,
  selector: string,
  options?: { waitForSelectorMs?: number },
): Promise<void> {
  const cursor = createCursor(page, undefined, false);
  await cursor.click(selector, {
    waitForSelector: options?.waitForSelectorMs ?? 12_000,
    hesitate: 80 + Math.floor(Math.random() * 200),
    waitForClick: 40 + Math.floor(Math.random() * 90),
  });
}
