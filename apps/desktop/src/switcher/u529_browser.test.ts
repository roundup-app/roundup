import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u529-"));

const art = captureDir("U529");

const session = `u529-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();

  if (art) mkdirSync(art, { recursive: true });
  origin = server.resolvedUrls.local[0]!;

  const ready = await fetch(new URL("/__roundup_ready", origin));

  if (!ready.ok) throw new Error(await ready.text());
  await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", origin).href);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

it("u529_switcher_keeps_d2_d5_d6_on_tree_40", async () => {
  for (const scheme of ["light", "dark"]) {
    await browser("set", "viewport", "1280", "800");
    await browser("set", "media", scheme);
    await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
    await browser("wait", "--fn", `!!window.__fake && !!document.querySelector('.rail-row')`);

    const before = await read<Checks>(`window.__checks()`);

    await browser("press", "Meta+k");
    await browser("press", "k");
    await browser("wait", "--fn", `document.activeElement?.closest('.switcher') !== null`);
    await browser("keyboard", "type", "agent");

    const during = await read<Checks>(`window.__checks()`);

    if (art) {
      await browser("screenshot", join(art, `1280-${scheme}-switcher.png`));
      writeFileSync(join(art, `1280-${scheme}-switcher.checks.json`), JSON.stringify(during));
    }

    for (const id of CHECK_IDS) if (before[id].status === "pass") expect(during[id].status, `${scheme} ${id}`).toBe("pass");

    for (const id of ["D2", "D5", "D6"] as const) expect(during[id].status, `${scheme} ${id}`).toBe("pass");

    expect(await read(`(() => {
      const box = document.querySelector('.switcher').getBoundingClientRect();
      const row = document.querySelector('.switcher [data-highlighted]');
      return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)';
    })()`)).toBe(true);
  }
}, 120_000);
