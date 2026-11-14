import { agentBrowserExecutable } from "../testing/chromePage";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u5557-"));

const session = `u5557-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 }).catch(error => { throw new Error([error.message, error.stdout, error.stderr].join("\n")); })).stdout;

const read = async (expression: string) => {
  // SAFETY: agent-browser supplies the envelope for these constant observer expressions.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: unknown }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer({ root: process.env.U5557_ROOT ?? process.cwd() });

  const ready = await fetch(new URL("/__roundup_ready", server.resolvedUrls.local[0]!));

  if (!ready.ok) throw new Error(await ready.text());

  await browser("--profile", profile, "--args", "--no-sandbox", "--color-scheme", "dark", "open");
  await browser("open", new URL("/harness.html?seed=empty-project", server.resolvedUrls.local[0]!).href);
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); }
  finally { await server?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }); }
});

it("u5557b_every_chip_uses_keychip", async () => {
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const dirs = [captureDir("U5557a"), captureDir("U5557c")].flatMap(dir => dir === null ? [] : [join(dir, phase)]);

  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  if (dirs.length) await browser("record", "start", join(dirs[0]!, "creation-help.webm"));

  for (const seed of ["empty-project", "first-run", "tree-40"]) {
    await browser("open", new URL(`/harness.html?seed=${seed}`, server.resolvedUrls.local[0]!).href);
    await browser("set", "media", "dark");
    await browser("wait", "--fn", seed === "first-run" ? `!!document.querySelector('.choose-project kbd')` : `!!window.__fake && !!document.querySelector('.rail-actions button')`);

    if (seed === "tree-40") {
      await browser("click", '.rail-actions [aria-label="Create"]');
      await browser("wait", "--fn", `!!document.querySelector('[role=menuitem][data-value=agent]')`);
      await read(`window.__fake.failNext(-32003, 'Could not start the Agent. Try again.', 'agent.spawn')`);
      await browser("click", '[role=menuitem][data-value=agent]');
      await browser("wait", "--fn", `document.querySelector('.rail-command-notice')?.textContent.includes('Could not start the Agent. Try again.')`);

      for (const dir of dirs) {
        await browser("screenshot", join(dir, "dense-failure-footer.png"));
        writeFileSync(join(dir, "dense-failure-footer.checks.json"), JSON.stringify(await read("window.__checks()"), null, 2));
      }

      await browser("press", "?");
      await browser("wait", "--fn", `!!document.querySelector('.help kbd')`);
    }

    if (seed === "empty-project") {
      await browser("click", '.rail-actions [aria-label="Create"]');
      await browser("wait", "--fn", `!!document.querySelector('[role=menuitem] kbd')`);
    }

    if (phase !== "base") expect(await read(`Array.from(document.querySelectorAll('kbd')).every(chip => chip.classList.contains('key-chip'))`)).toBe(true);

    for (const dir of dirs) {
      await browser("screenshot", join(dir, `${seed}.png`));
      writeFileSync(join(dir, `${seed}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
    }
  }

  if (dirs.length) {
    await browser("record", "stop");

    for (const dir of dirs.slice(1)) copyFileSync(join(dirs[0]!, "creation-help.webm"), join(dir, "creation-help.webm"));
  }
}, 90_000);
