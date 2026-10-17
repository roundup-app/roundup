import { execFile, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";

// A fake browser that never answers needs no 20 s wait to prove the timeout's report.
const REPLY_MS = 5_000;

it.runIf(process.platform === "linux")("u26_parallel_cold_pages_answer_under_a_read_iops_limit_within_the_measured_startup_bound", async () => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const source = dirname(realpathSync(found));
  const dir = mkdtempSync(join(tmpdir(), "u26-cold-"));
  const group = join("/sys/fs/cgroup", basename(dir));
  const browser = join(dir, "browser", "chrome");
  const runner = join(dir, "run.mts");
  const launcher = join(dir, "launch.py");

  try {
    // Only this copy is evicted. The caller's browser and host cache stay intact.
    cpSync(source, join(dir, "browser"), { recursive: true, dereference: true });
    execFileSync("python3", ["-c", `
import os, pathlib, subprocess, sys
root, group = sys.argv[1:]
subprocess.run(['sudo', '-n', 'mkdir', group], timeout=5, check=True)
device = os.stat(root).st_dev
block = pathlib.Path(f'/sys/dev/block/{os.major(device)}:{os.minor(device)}').resolve()
if (block / 'partition').exists():
    block = block.parent
subprocess.run(['sudo', '-n', 'tee', group + '/io.max'], input=block.joinpath('dev').read_text().strip() + ' riops=100', text=True, stdout=subprocess.DEVNULL, timeout=5, check=True)
for path in pathlib.Path(root).rglob('*'):
    if path.is_file():
        with path.open('rb') as source:
            os.fsync(source.fileno())
            os.posix_fadvise(source.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
`, join(dir, "browser"), group], { timeout: 30_000 });

    writeFileSync(launcher, `
import os, subprocess, sys
subprocess.run(['sudo', '-n', 'tee', ${JSON.stringify(join(group, "cgroup.procs"))}], input=str(os.getpid()), text=True, stdout=subprocess.DEVNULL, timeout=5, check=True)
os.execv(sys.argv[1], sys.argv[1:])
`);
    writeFileSync(runner, `
import { openPage } from ${JSON.stringify(join(process.cwd(), "src/testing/chromePage.ts"))};
const pages = await Promise.allSettled([0, 1].map(() => openPage(${JSON.stringify(browser)}, { root: ${JSON.stringify(process.cwd())} })));
try {
  const opened = pages.map(page => {
    if (page.status === 'rejected') throw page.reason;
    return page.value;
  });
  const values = await Promise.all(opened.map(page => page.call('() => 42')));
  console.log(JSON.stringify(values));
} finally {
  await Promise.all(pages.map(page => page.status === 'fulfilled' ? page.value.close() : undefined));
}
`);

    const output = await new Promise<string>((resolve, reject) => {
      execFile("python3", [launcher, process.execPath, "--experimental-strip-types", runner], { timeout: 90_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`${error.message}\n${stderr}`));
        else resolve(stdout);
      });
    });

    expect(output.trim()).toBe("[42,42]");
  } finally {
    // The cgroup contains only the subprocesses this test created.
    execFileSync("sudo", ["-n", "tee", join(group, "cgroup.kill")], { input: "1", stdio: ["pipe", "ignore", "pipe"], timeout: 5_000 });
    execFileSync("sudo", ["-n", "rmdir", group], { timeout: 5_000 });
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

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
    await expect(openPage(browser, { replyMs: REPLY_MS, startupMs: REPLY_MS })).rejects.toThrow(/Target.createTarget timed out after 5000 ms[\s\S]*threads:[\s\S]*State:\s+T \(stopped\)/);
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
    const failure = await openPage(browser, { replyMs: REPLY_MS, startupMs: REPLY_MS }).then(
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
    const failure = await openPage(browser, { replyMs: REPLY_MS, startupMs: REPLY_MS }).then(
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
