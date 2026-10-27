import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u483-"));

const session = `u483-${process.pid}`;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" }, maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", new URL(new URL("./u483Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html"), origin).href);

}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});


const load = async () => {
  await browser("open", new URL(new URL("./u483Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html"), origin).href);
  await browser("wait", "--fn", `!!document.querySelector('[role=tree]')`);
};

const snapshot = async () => {
  // SAFETY: agent-browser's snapshot envelope contains a string snapshot.
  const reply = JSON.parse(await browser("snapshot")) as { data: { snapshot: string } };

  return reply.data.snapshot;
};

it("u483_three_level_keyboard_walk", async () => {
  await load();
  await browser("press", "Tab");

  const at = async (name: string) => {
    await browser("wait", "--fn", `document.activeElement?.closest('[data-id]')?.getAttribute('data-id') === ${JSON.stringify(name)}`);
    expect(await read<string>(`document.activeElement.closest('[data-id]').getAttribute('data-id')`)).toBe(name);
  };

  await at("Alpha");

  const steps: [string, string, string, boolean, boolean][] = [
    ["ArrowRight", "Alpha", "true", true, false],
    ["ArrowRight", "Beta", "false", true, false],
    ["ArrowRight", "Beta", "true", true, true],
    ["ArrowRight", "Cedar", "leaf", true, true],
    ["ArrowLeft", "Beta", "true", true, true],
    ["ArrowLeft", "Beta", "false", true, false],
    ["ArrowDown", "Delta", "leaf", true, false],
    ["ArrowUp", "Beta", "false", true, false],
    ["ArrowLeft", "Alpha", "true", true, false],
    ["End", "Echo", "leaf", true, false],
    ["Home", "Alpha", "true", true, false],
    ["e", "Echo", "leaf", true, false],
    ["c", "Echo", "leaf", true, false],
  ];

  for (const [key, name, expanded, betaVisible, cedarVisible] of steps) {
    await browser("press", key);
    await at(name);

    if (expanded !== "leaf") {
      await browser("wait", "--fn", `document.querySelector('[data-id=${name}]').getAttribute('aria-expanded') === '${expanded}'`);
      expect(await read<string>(`document.querySelector('[data-id=${name}]').getAttribute('aria-expanded')`)).toBe(expanded);
    }

    expect(await read<boolean>(`document.querySelector('[data-id=Beta]').checkVisibility()`)).toBe(betaVisible);
    expect(await read<boolean>(`document.querySelector('[data-id=Cedar]').checkVisibility()`)).toBe(cedarVisible);
  }

  await load();
  await browser("press", "Tab");
  await at("Alpha");
  await browser("press", "ArrowRight");
  await browser("wait", "--fn", `document.querySelector('[data-id=Alpha]').getAttribute('aria-expanded') === 'true'`);
  await browser("press", "c");
  await at("Alpha");
  expect(await read<boolean>(`document.querySelector('[data-id=Cedar]').checkVisibility()`)).toBe(false);
}, 60_000);

it("u483_row_composition", async () => {
  await load();
  expect(await snapshot()).toContain('treeitem "Alpha"');
  expect(await snapshot()).toContain('button "Inspect Alpha"');
  await browser("press", "Tab");
  await browser("press", "ArrowRight");
  await browser("wait", "--fn", `document.querySelector('[data-id=Alpha]').getAttribute('aria-expanded') === 'true'`);
  expect(await snapshot()).toContain('treeitem "Beta"');
  expect(await snapshot()).toContain('button "Inspect Beta"');
  await browser("find", "role", "button", "click", "--name", "Select Cedar", "--exact");
  await browser("wait", "--fn", `document.querySelector('[data-id=Cedar]').getAttribute('aria-selected') === 'true'`);
  expect(await read<string[]>(`[...document.querySelectorAll('[data-id]')].map(el => el.dataset.id)`)).toEqual(["Alpha", "Beta", "Cedar", "Delta", "Echo"]);
  expect(await read<number>(`document.querySelectorAll('[data-id] [aria-hidden=true]').length`)).toBe(5);

  const tree = await snapshot();

  for (const name of ["Alpha", "Beta", "Cedar", "Delta", "Echo"]) {
    expect(tree).toContain(`button "Inspect ${name}"`);
    expect(tree).toContain(`treeitem "${name}"`);
  }

  expect(await read<string[]>(`[...document.querySelectorAll('[data-id] [aria-hidden=true]')].map(el => el.textContent)`)).toEqual(Array(5).fill("○"));
}, 60_000);

it("u483_tree_semantics_and_names", async () => {
  await load();
  expect(await snapshot()).toContain('tree "Project tree"');
  expect(await read<number>(`document.querySelectorAll('[role=tree]').length`)).toBe(1);
  expect(await read<string>(`document.querySelector('[data-id=Alpha]').getAttribute('aria-expanded')`)).toBe("false");
  await browser("press", "Tab");
  await browser("press", "ArrowRight");
  await browser("wait", "--fn", `document.querySelector('[data-id=Alpha]').getAttribute('aria-expanded') === 'true'`);
  await browser("press", "ArrowRight");
  await browser("wait", "--fn", `document.activeElement.closest('[data-id]')?.dataset.id === 'Beta'`);
  await browser("press", "ArrowRight");
  await browser("wait", "--fn", `document.querySelector('[data-id=Beta]').getAttribute('aria-expanded') === 'true'`);

  const tree = await snapshot();

  for (const name of ["Alpha", "Beta", "Cedar", "Delta", "Echo"]) expect(tree).toContain(`treeitem "${name}"`);

  expect(await read<(string | null)[]>(`['Alpha','Beta','Cedar'].map(id => document.querySelector('[data-id='+id+']').getAttribute('aria-level'))`)).toEqual(["1", "2", "3"]);
  expect(await read<(string | null)[]>(`['Cedar','Delta','Echo'].map(id => document.querySelector('[data-id='+id+']').getAttribute('aria-expanded'))`)).toEqual([null, null, null]);
}, 60_000);
