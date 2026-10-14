import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";

it.runIf(process.platform === "linux")("u26_parallel_pages_answer_while_the_host_font_configuration_is_held", async () => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const dir = mkdtempSync(join(tmpdir(), "u26-fonts-"));
  const config = join(dir, "fonts.conf");

  // Fontconfig opens its inherited config during startup. A FIFO with no
  // writer holds that read before either real browser can answer DevTools.
  execFileSync("mkfifo", [config]);
  vi.stubEnv("FONTCONFIG_FILE", config);
  const pages = await Promise.allSettled(Array.from({ length: 2 }, () => openPage(found)));

  try {
    const opened = pages.map((page) => {
      if (page.status === "rejected") throw page.reason;

      return page.value;
    });

    expect(await Promise.all(opened.map((page) => page.call<number>("() => 42")))).toEqual([42, 42]);
  } finally {
    await Promise.all(pages.map((page) => page.status === "fulfilled" ? page.value.close() : undefined));
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
}, 40_000);
