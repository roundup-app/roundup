import { chromePath, openPage } from "./chromePage";

/** A cold start may read the whole browser from disk; on a fresh runner that read can outlast the 20 s DevTools reply budget. */
const COLD_REPLY_MS = 120_000;

/**
 * Vitest's global setup: starts the test Chrome once, before any test file, so its first-start disk reads are cached
 * and no test's DevTools reply budget pays them. CI shows only a runner's first Chrome starts failing `Target.createTarget`.
 */
export default async function warmChrome(): Promise<void> {
  const found = chromePath();

  // Each browser test reports a missing Chrome itself.
  if (found === undefined) return;

  const started = Date.now();
  const page = await openPage(found, { replyMs: COLD_REPLY_MS });

  await page.close();
  console.log(`Chrome first start: ${Date.now() - started} ms`);
}
