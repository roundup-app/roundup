import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openPage } from "./chromePage";

it("u26_a_live_browser_with_closed_devtools_pipes_rejects_page_creation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-pipe-"));
  const browser = join(dir, "browser.mjs");

  // Close the request socket without reading its queued bytes, forcing a
  // reset, then close the reply socket. The browser itself remains alive.
  writeFileSync(browser, `#!/usr/bin/env node
import { closeSync } from 'node:fs';
closeSync(3);
closeSync(4);
setInterval(() => {}, 1000);
`, { mode: 0o755 });

  try {
    await expect(openPage(browser)).rejects.toThrow(/Target.createTarget: DevTools (request|reply) pipe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
