import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";

it.runIf(process.platform === "linux")("u26_parallel_pages_answer_while_another_browser_holds_its_crashpad_settings", async () => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const dir = mkdtempSync(join(tmpdir(), "u26-crashpad-"));

  // Crashpad locks settings.dat outside --user-data-dir. Hold the real file
  // locks before either browser starts; no timing race or mock DevTools reply.
  const holder = spawn("python3", ["-u", "-c", `
import fcntl, pathlib, sys
files = []
for name in ('google-chrome', 'google-chrome-for-testing', 'chromium'):
    path = pathlib.Path(sys.argv[1]) / name / 'Crash Reports' / 'settings.dat'
    path.parent.mkdir(parents=True, exist_ok=True)
    file = path.open('w+b')
    fcntl.flock(file, fcntl.LOCK_EX)
    files.append(file)
print('locked', flush=True)
sys.stdin.read()
`, dir], { stdio: ["pipe", "pipe", "pipe"] });

  const exited = new Promise<void>((resolve) => holder.once("close", () => resolve()));

  try {
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.once("exit", (code) => reject(new Error(`U26 lock holder exited ${code}`)));
      holder.stdout.once("data", () => resolve());
    });
    vi.stubEnv("CHROME_CONFIG_HOME", dir);
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    const pages = await Promise.allSettled(Array.from({ length: 2 }, () => openPage(found)));

    try {
      const opened = pages.map((page) => {
        if (page.status === "rejected") throw page.reason;

        return page.value;
      });

      expect(await Promise.all(opened.map((page) => page.call<number>("() => 42")))).toEqual([42, 42]);
    } finally {
      await Promise.all(pages.map((page) => page.status === "fulfilled" ? page.value.close() : undefined));
    }
  } finally {
    vi.unstubAllEnvs();
    holder.stdin.end();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
}, 40_000);
