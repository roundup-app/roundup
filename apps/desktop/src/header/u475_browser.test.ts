import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u475-"));

const session = `u475-${process.pid}`;

const art = captureDir("U475");

let server: ViteDevServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await createServer({ cacheDir: join(profile, "vite"), server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!;
  await browser("--profile", profile, "open", origin);

  if (art) mkdirSync(art, { recursive: true });
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const focused = async (name: string) => browser("wait", "--fn", `document.activeElement?.textContent === ${JSON.stringify(name)}`);

const open = async () => {
  await browser("hover", ".project-tab");
  await browser("eval", `(() => { const opener = document.querySelector('[aria-label^="Close "]'); opener.focus(); opener.click(); })()`);
  await browser("wait", "--fn", `!!document.querySelector('[role="alertdialog"]')`);
  await focused("Cancel");
};

const closed = async () => {
  await browser("wait", "--fn", `!document.querySelector('[role="alertdialog"]') && document.activeElement?.getAttribute('aria-label')?.startsWith('Close ')`);
};

for (const scheme of ["light", "dark"]) for (const width of [1280, 1440]) {
  it(`u475_close_dialog_wraps_focus_cancels_stops_once_failure_is_visible_checks ${scheme}-${width}`, async () => {
    await browser("set", "media", scheme);
    await browser("set", "viewport", String(width), "800");
    await browser("open", `${origin}/harness.html?seed=tree-40`);
    await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
    const baseline = await read<Checks>("window.__checks()");
    await browser("eval", `(() => { window.__u475Calls = []; window.__fake.app.closeProject = async path => { window.__u475Calls.push(path); throw new Error('could not stop rupd'); }; })()`);

    if (art) await browser("screenshot", join(art, `${scheme}-${width}-before.png`));
    await open();
    await browser("press", "Tab"); await focused("Stop and close");
    await browser("press", "Tab"); await focused("Cancel");
    await browser("press", "Shift+Tab"); await focused("Stop and close");
    await browser("press", "Escape"); await closed();
    await open(); await browser("find", "role", "button", "click", "--name", "Cancel", "--exact"); await closed();
    await open(); await browser("mouse", "move", "10", "400"); await browser("mouse", "down"); await browser("mouse", "up"); await closed();
    expect(await read<unknown[]>("window.__u475Calls")).toEqual([]);
    await open();
    const checks = await read<Checks>("window.__checks()");

    for (const id of ["D2", "D5", "D6"] as const) expect(checks[id], id).toMatchObject({ status: "pass" });

    for (const id of CHECK_IDS) {
      if (baseline[id].status === "pass") expect(checks[id].status, id).toBe("pass");
    }

    if (art) {
      await browser("screenshot", join(art, `${scheme}-${width}-question.png`));
      writeFileSync(join(art, `${scheme}-${width}.checks.json`), JSON.stringify({ baseline, checks }, null, 2));
    }

    await browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");
    await browser("wait", "--fn", `document.body.textContent.includes('could not stop rupd')`);
    expect(await read<number>("window.__u475Calls.length")).toBe(1);
    expect(await read<number>("document.querySelectorAll('[role=tab]').length")).toBeGreaterThan(0);

    const failureChecks = await read<Checks>("window.__checks()");

    for (const id of CHECK_IDS) {
      if (baseline[id].status === "pass") expect(failureChecks[id].status, id).toBe("pass");
    }

    if (art) {
      await browser("screenshot", join(art, `${scheme}-${width}-failure.png`));
      writeFileSync(join(art, `${scheme}-${width}-failure.checks.json`), JSON.stringify(failureChecks, null, 2));
    }
  }, 90_000);
}

it("u184_a_click_outside_closes_nothing", async () => {
  await browser("open", `${origin}/harness.html?seed=tree-40`);
  await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
  const count = await read<number>("document.querySelectorAll('[role=tab]').length");
  await open();
  await browser("mouse", "move", "10", "400");
  await browser("mouse", "down");
  await browser("mouse", "up");
  await closed();
  expect(await read<unknown[]>("window.__fake.app.closed")).toEqual([]);
  expect(await read<number>("document.querySelectorAll('[role=tab]').length")).toBe(count);
}, 60_000);
