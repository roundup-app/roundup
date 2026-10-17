import { afterAll, beforeAll, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u466-browser-"));

const session = `u466-${process.pid}`;

// Under controlled contention the warmed batch took 3,422 ms and read 390 ms.
// Bound commands at 4 s while retaining the observer's existing 5 s limit.
const command = async (args: string[], input?: string, limit = 4_000) => {
  const started = performance.now();
  const label = JSON.stringify(args) + (input ?? "");

  const pending = exec("agent-browser", ["--session", session, "--json", ...args], {
    maxBuffer: 8 * 1024 * 1024, timeout: limit,
  });

  pending.child.stdin?.end(input);

  try {
    const reply = await pending;

    return reply.stdout;
  } catch (error) {
    const state = error instanceof Error && "killed" in error && error.killed ? "pending" : "failed";
    const output = error instanceof Error && "stdout" in error ? String(error.stdout) : "";
    throw new Error(`${state} browser command after ${Math.round(performance.now() - started)} ms (limit ${limit} ms): ${label}: ${String(error)} ${output}`, { cause: error });
  }
};

const browser = (...args: string[]) => command(args);

let server: ViteDevServer;

let origin: string;

const page = {
  until: async (predicate: string) => { await browser("wait", "--fn", `(${predicate})()`); },
  call: async <T,>(declaration: string, ...args: unknown[]): Promise<T> => {
    // SAFETY: agent-browser's JSON envelope contains the result of this constant page expression.
    const reply = JSON.parse(await browser("eval", `(${declaration})(...${JSON.stringify(args)})`)) as { success: boolean; data: { result: T }; error: string | null };

    if (!reply.success) throw new Error(reply.error ?? "browser evaluation failed");

    return reply.data.result;
  },
};

const art = captureDir("U466");

beforeAll(async () => {
  server = await createServer({ cacheDir: join(profile, "vite"), server: { port: 0, hmr: false }, logLevel: "silent" });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
  // index.html loads main.tsx; the tests navigate to harness.tsx. Warm the entry
  // they actually use so cold harness transforms stay inside the startup hook.
  await command(["--profile", profile, "open", origin + "/harness.html?seed=tree-40"], undefined, 60_000);
}, 90_000);

afterAll(async () => {
  try { await browser("close"); }
  finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const load = async (seed = "tree-40") => {
  const commands = [
    ["set", "media", "light"],
    ["set", "viewport", "1280", "800"],
    ["open", origin + "/harness.html?seed=" + seed],
    ["wait", "--fn", "document.querySelectorAll('.rail-row').length > 8"],
    ["eval", "document.querySelector('.rail-row[data-id]').click()"],
    ["wait", "--fn", `Boolean(document.querySelector('.rail-row[data-selected="true"]'))`],
  ];

  // SAFETY: agent-browser batch returns its ordered command/success/error envelopes.
  const replies = JSON.parse(await command(["batch", "--bail"], JSON.stringify(commands))) as { command: string[]; success: boolean; error: string | null }[];

  for (const reply of replies) {
    if (!reply.success) throw new Error(`browser command ${JSON.stringify(reply.command)} failed: ${reply.error}`);
  }
};

it("u466_ten_agents_keep_selection_and_attention_distinct", async () => {
  await load("agents-10");
  expect(await page.call(`() => ({selected:document.querySelectorAll('.rail-row[data-selected="true"]').length,attention:[...document.querySelectorAll('.rail .glyph.ink')].map(g=>g.getAttribute('aria-label'))})`)).toEqual({selected:1,attention:expect.arrayContaining(["Error","Needs-you"])});
});

it("u466_glyphs_keep_the_six_kinds", async () => {
  await load("agents-10");
  await page.call("() => document.querySelector('.rail-fold button').click()");
  await page.until("() => Boolean(document.querySelector('.rail .glyph[aria-label=\"Done\"]'))");

  const kinds = await page.call<string[]>("() => [...document.querySelectorAll('.rail .glyph')].map(g=>g.getAttribute('aria-label')).filter(Boolean)");

  expect(new Set(kinds)).toEqual(new Set(["Error","Needs-you","Blocked","Working","Idle","Done"]));
},60_000);

it("u466_failure_text_stays_visible_on_the_densest_seed", async () => {
  await load();
  await page.call(`() => {window.__fake.app.editorFailure=new Error('no code editor found');document.querySelector('.rail-row [aria-label="Open in editor"]').click();}`);
  await page.until("() => Boolean(document.querySelector('.rail > .ink'))");
  expect(await page.call<string>("() => document.querySelector('.rail > .ink').textContent")).toContain("no code editor found");

  if(art) {
    await browser("screenshot",join(art,"failure.png"));
    writeFileSync(join(art,"failure.checks.json"),JSON.stringify(await page.call("() => window.__checks()")));
  }
},60_000);
