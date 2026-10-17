import { chromePath, openPage, FULLSCREEN } from "./chromePage";
import type { ChromePage } from "./chromePage";

/** U2307: the isolated Chromium page with one open bubble at 1512 by 950. */
export const openBubblePage = async (): Promise<ChromePage> => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2307 requires Chromium");

  return openPage(chrome);
};

export const showBubble = async (page: ChromePage, scheme: "light" | "dark" = "light"): Promise<void> => {
  await page.scheme(scheme);
  await page.load("/harness.html?seed=door-stopped", FULLSCREEN.width, FULLSCREEN.height);
  await page.until(`() => document.querySelector('.terminal-new')`);
  await page.call(`() => document.querySelector('.terminal-new').click()`);
  await page.until(`() => document.querySelector('.bubble:not([hidden]) .xterm-screen')`);
};

export const centreOf = (page: ChromePage, selector: string) =>
  page.call<{ x: number; y: number }>(`() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }`);
