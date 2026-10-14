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

it("u26_a_live_browser_with_an_ended_reply_pipe_rejects_page_creation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-pipe-"));
  const browser = join(dir, "browser.mjs");

  // Read the request before closing only the reply pipe: no reset on the
  // request socket and no process exit can account for this rejection.
  writeFileSync(browser, `#!/usr/bin/env node
import { closeSync, createReadStream } from 'node:fs';
createReadStream(null, {fd: 3}).once('data', () => closeSync(4));
setInterval(() => {}, 1000);
`, { mode: 0o755 });

  try {
    await expect(openPage(browser)).rejects.toThrow("Target.createTarget: DevTools reply pipe closed before replying");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it("u26_a_lost_reply_pipe_rejects_pending_and_later_page_calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-pipe-"));
  const browser = join(dir, "browser.mjs");

  // Speak enough DevTools to open the page, then end replies during a call.
  // Continue consuming requests so only the lost reply path ends the calls.
  writeFileSync(browser, `#!/usr/bin/env node
import { closeSync, createReadStream, writeSync } from 'node:fs';
let buffer = '';
let closed = false;
createReadStream(null, {fd: 3}).on('data', chunk => {
  buffer += chunk.toString();
  for (let end = buffer.indexOf('\\0'); end >= 0; end = buffer.indexOf('\\0')) {
    const request = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (closed) continue;
    if (request.method === 'Runtime.callFunctionOn') {
      closed = true;
      closeSync(4);
      continue;
    }
    const result = request.method === 'Target.createTarget' ? {targetId: 'page'}
      : request.method === 'Target.attachToTarget' ? {sessionId: 'session'}
      : request.method === 'Runtime.evaluate' ? {result: {objectId: 'global'}} : {};
    writeSync(4, JSON.stringify({id: request.id, result}) + '\\0');
  }
});
`, { mode: 0o755 });

  try {
    const page = await openPage(browser);

    try {
      await expect(page.call("() => 42")).rejects.toThrow("Runtime.callFunctionOn: DevTools reply pipe closed before replying");
      await expect(page.call("() => 42")).rejects.toThrow("Runtime.evaluate: DevTools reply pipe closed before replying");
    } finally {
      await page.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
