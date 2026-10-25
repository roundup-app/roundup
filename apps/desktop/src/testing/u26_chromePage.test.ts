import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";

// A fake browser that never answers needs no 20 s wait to prove the timeout's report.
const REPLY_MS = 5_000;

it("u26_later_page_loads_keep_their_own_reply_budget", async () => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const dir = mkdtempSync(join(tmpdir(), "u26-reload-"));

  writeFileSync(join(dir, "index.html"), "<!doctype html><p>fresh document</p>");

  try {
    const page = await openPage(found, { root: dir });
    // Advance the host monotonic clock beyond startup without sleeping or changing
    // Chrome's document clock. A later load must still create its fresh tab.
    const clock = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 60_000);

    try {
      await page.load("/");
      expect(await page.call<string>("() => document.querySelector('p').textContent")).toBe("fresh document");
      expect(await page.call<string>("() => `${innerWidth}x${innerHeight}`")).toBe("1512x950");
    } finally {
      clock.mockRestore();
      await page.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it("u26_a_failed_page_start_releases_its_browser", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-browser-"));
  const browser = join(dir, "browser.mjs");
  const pid = join(dir, "pid");
  const stopped = join(dir, "stopped");

  // A real subprocess rejects page creation and stays alive until its owner closes it.
  writeFileSync(browser, `#!/usr/bin/env node
import { createReadStream, writeFileSync, writeSync } from 'node:fs';
writeFileSync(${JSON.stringify(pid)}, String(process.pid));
process.on('SIGTERM', () => {
  writeFileSync(${JSON.stringify(stopped)}, 'closed');
  process.exit(0);
});
let buffer = '';
createReadStream(null, {fd: 3}).on('data', chunk => {
  buffer += chunk.toString();
  const end = buffer.indexOf('\\0');
  if (end < 0) return;
  const request = JSON.parse(buffer.slice(0, end));
  buffer = buffer.slice(end + 1);
  writeSync(4, JSON.stringify({id: request.id, error: {message: 'page creation failed'}}) + '\\0');
});
`, { mode: 0o755 });

  try {
    await expect(openPage(browser)).rejects.toThrow("page creation failed");
    expect(readFileSync(stopped, "utf8")).toBe("closed");
  } finally {
    try { process.kill(Number(readFileSync(pid, "utf8")), "SIGKILL"); } catch { /* Already closed. */ }

    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it("u26_a_page_start_timeout_reports_chromium_stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-browser-"));
  const browser = join(dir, "browser.mjs");

  // A live browser with no DevTools reply distinguishes a startup stall from an exit.
  writeFileSync(browser, `#!/usr/bin/env node
import { createReadStream, writeSync } from 'node:fs';
writeSync(2, 'U26 browser startup diagnostic\\n');
createReadStream(null, {fd: 3}).resume();
`, { mode: 0o755 });

  try {
    await expect(openPage(browser, { replyMs: REPLY_MS, startupMs: REPLY_MS })).rejects.toThrow(/Target.createTarget timed out after 5000 ms[\s\S]*U26 browser startup diagnostic/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

