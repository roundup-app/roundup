import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";

const overrides = ["FONTCONFIG_FILE", "FONTCONFIG_PATH", "FONTCONFIG_SYSROOT"] as const;

it.runIf(process.platform === "linux").each(overrides)("u26_parallel_pages_answer_while_the_host_font_configuration_is_kept_open_via_%s", async (name) => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const dir = mkdtempSync(join(tmpdir(), "u26-fonts-"));
  const path = name === "FONTCONFIG_SYSROOT" ? join(dir, "etc", "fonts") : dir;

  mkdirSync(path, { recursive: true });

  const config = join(path, "fonts.conf");

  // Fontconfig opens its inherited config during startup. A FIFO with no
  // writer holds that read before either real browser can answer DevTools.
  execFileSync("mkfifo", [config], { timeout: 5_000 });

  for (const override of overrides) vi.stubEnv(override, undefined);

  vi.stubEnv(name, name === "FONTCONFIG_FILE" ? config : dir);
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

const homes = ["HOME", "XDG_CONFIG_HOME"] as const;

it.runIf(process.platform === "linux").each(homes)("u26_parallel_pages_answer_while_the_host_user_font_configuration_is_kept_open_via_%s", async (name) => {
  const found = chromePath();

  if (!found) throw new Error("U26 requires isolated Chromium");

  const dir = mkdtempSync(join(tmpdir(), "u26-user-fonts-"));
  const config = name === "HOME" ? join(dir, ".fonts.conf") : join(dir, "fontconfig", "fonts.conf");

  mkdirSync(join(dir, "fontconfig"));
  // System 50-user.conf includes both HOME/.fonts.conf and the XDG user
  // fonts.conf even without any FONTCONFIG override. Keep that open
  // while both real browsers must create their pages and answer a call.
  execFileSync("mkfifo", [config], { timeout: 5_000 });

  for (const override of overrides) vi.stubEnv(override, undefined);

  vi.stubEnv(name, dir);
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
