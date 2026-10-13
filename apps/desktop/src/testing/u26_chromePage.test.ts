import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openPage } from "./chromePage";

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
