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

const profile = mkdtempSync(join(tmpdir(), "u485-"));

const session = `u485-${process.pid}`;

const art = captureDir("U485");

let server: ViteDevServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" }, maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

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

const baseline = process.env.ROUNDUP_CAPTURE_BASE === "1";

it("u485_rendered_checks", async () => {
  for (const width of [1280, 1440]) for (const scheme of ["light", "dark"]) {
    await browser("set", "viewport", String(width), "800");
    await browser("set", "media", scheme);

    for (const surface of ["tree", "sort", "failure"]) {
      const path = surface === "failure" ? "/harness.html?seed=tree-40" : baseline ? "/src/ui/u474.html" : surface === "tree" ? "/src/ui/u483.html" : "/src/ui/u484.html?dense";
      await browser("open", new URL(path, origin).href);

      if (surface === "failure") {
        await browser("wait", "--fn", `!!window.__fake && document.querySelectorAll('.rail-row').length > 2`);
        await browser("eval", `window.__fake.app.closeProject = async () => { throw new Error('could not stop rupd'); }`);
        await browser("hover", ".project-tab");
        await browser("eval", `document.querySelector('[aria-label^="Close "]').click()`);
        await browser("wait", "--fn", `!!document.querySelector('[role=alertdialog]')`);
        await browser("find", "role", "button", "click", "--name", "Stop and close", "--exact");
        await browser("wait", "--fn", `document.body.textContent.includes('could not stop rupd')`);
      } else if (!baseline && surface === "tree") {
        await browser("wait", "--fn", `!!document.querySelector('[role=tree]')`);
        await browser("click", "button[data-button=quiet]");
        await browser("wait", "--fn", `document.querySelector('[data-id=Cedar]').getAttribute('aria-selected') === 'true'`);
      } else if (!baseline) {
        await browser("wait", "--fn", `document.querySelectorAll('.sortable-row').length === 40`);
        await browser("focus", '[aria-label="Move 12"]');
        await browser("wait", "--fn", `document.querySelector('.sortable-fixture').scrollTop > 0`);
      } else await browser("wait", "--fn", `!!document.querySelector('[aria-label="Actions taken"]')`);
      const checks = await read<Checks>(`import('/src/testing/checks.ts').then(module => module.runChecks(document))`);

      if (art) {
        const dir = join(art, baseline ? "base" : "head");
        mkdirSync(dir, { recursive: true });
        const name = `${surface}-${width}-${scheme}`;
        await browser("screenshot", join(dir, `${name}.png`));
        writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(checks, null, 2));
      }

      for (const id of CHECK_IDS) expect(checks[id], `${surface} ${width} ${scheme} ${id}`).toMatchObject({ status: "pass" });
    }
  }
}, 180_000);
