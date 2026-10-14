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
    await expect(openPage(browser)).rejects.toThrow(/Target.createTarget timed out after 20000 ms[\s\S]*U26 browser startup diagnostic/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it.runIf(process.platform === "linux")("u26_a_page_start_timeout_identifies_a_stopped_browser_before_teardown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-browser-"));
  const browser = join(dir, "browser.mjs");

  // Stop after receiving the request: the browser remains alive but cannot
  // answer. The diagnostic must observe this state before teardown kills it.
  writeFileSync(browser, `#!/usr/bin/env node
import { createReadStream } from 'node:fs';
createReadStream(null, {fd: 3}).once('data', () => process.kill(process.pid, 'SIGSTOP'));
`, { mode: 0o755 });

  try {
    await expect(openPage(browser)).rejects.toThrow(/Target.createTarget timed out after 20000 ms[\s\S]*threads:[\s\S]*State:\s+T \(stopped\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it.runIf(process.platform === "linux")("u26_a_page_start_timeout_identifies_a_stopped_browser_child_before_teardown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-browser-"));
  const browser = join(dir, "browser.mjs");
  const pid = join(dir, "child-pid");

  // The browser stays runnable while a child it needs cannot progress.
  // Observing only the browser's threads hides the stopped dependency.
  writeFileSync(browser, `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createReadStream, writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'process.send("ready"); setInterval(() => {}, 1000)'], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
child.once('message', () => {
  writeFileSync(${JSON.stringify(pid)}, String(child.pid));
  child.kill('SIGSTOP');
  createReadStream(null, {fd: 3}).resume();
});
process.on('SIGTERM', () => {
  child.once('exit', () => process.exit(0));
  child.kill('SIGKILL');
});
`, { mode: 0o755 });

  try {
    const failure = await openPage(browser).then(
      async (page) => {
        await page.close();

        return "unexpected page";
      },
      (error: Error) => error.message,
    );

    const child = readFileSync(pid, "utf8");

    expect(failure).toMatch(new RegExp(`process ${child}:[\\s\\S]*State:\\s+T \\(stopped\\)`));
  } finally {
    try { process.kill(Number(readFileSync(pid, "utf8")), "SIGKILL"); } catch { /* Already closed. */ }

    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

it.runIf(process.platform === "linux")("u26_a_page_start_timeout_preserves_the_backing_files_of_browser_memory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "u26-browser-"));
  const browser = join(dir, "browser.py");
  const backing = join(dir, "startup-resource");

  writeFileSync(backing, Buffer.alloc(4096));
  // Keep a real file mapped until teardown. A disk-wait instruction address
  // is not actionable without the mapping and its backing file.
  writeFileSync(browser, `#!/usr/bin/env python3
import mmap, os, signal
with open(${JSON.stringify(backing)}, 'rb') as source:
    resource = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
    os.read(3, 4096)
    os.kill(os.getpid(), signal.SIGSTOP)
`, { mode: 0o755 });

  try {
    const failure = await openPage(browser).then(
      async (page) => {
        await page.close();

        return "unexpected page";
      },
      (error: Error) => error.message,
    );

    expect(failure).toContain(backing);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
