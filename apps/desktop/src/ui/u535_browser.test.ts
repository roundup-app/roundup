import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u535-"));

const session = `u535-${process.pid}`;

const INDENT = 24;

let server: AppServer;

let origin: string;

const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "15000" }, maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: the envelope is agent-browser's result for the constant expressions below.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

const page = (query = "") => new URL(`${new URL("./u535Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html")}${query}`, origin).href;

beforeAll(async () => {
  server = await appServer();
  origin = server.resolvedUrls.local[0]!;
  await browser("--profile", profile, "open", page());
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const load = async (query = "") => {
  await browser("open", page(query));
  await browser("wait", "--fn", `document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])').length === 5`);
};

const output = (label: string) => read<string>(`document.querySelector('[aria-label="${label}"]').textContent`);

// SAFETY: the fixture prints JSON.stringify of its recorded moves.
const moves = async () => JSON.parse(await output("Moves")) as unknown[];

const box = (selector: string) => read<{ x: number; y: number; bottom: number }>(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, bottom: rect.bottom }; })()`);

/** Presses the handle of `id`, then moves the pointer to the gap below `below` shifted `shift` indents right of where the press began. */
const dragToGapBelow = async (id: string, below: string, shift: number) => {
  const start = await box(`[aria-label="Move ${id}"]`);
  const target = await box(`[data-id="${below}"]`);
  const x = Math.round(start.x);
  await browser("mouse", "move", String(x), String(Math.round(start.y)));
  await browser("mouse", "down");
  await browser("mouse", "move", String(x + 15), String(Math.round(start.y)));
  await browser("wait", "--fn", `document.querySelector('[data-id="${id}"]').dataset.dragging === 'true'`);
  await browser("mouse", "move", String(x + 15), String(Math.round(target.bottom + 2)));
  await browser("mouse", "move", String(x + shift * INDENT), String(Math.round(target.bottom + 2)));
};

const release = async () => {
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[aria-label="Previews"]').textContent.endsWith('end')`);
};

it("u535_pointer_sets_parent", async () => {
  await load();
  await dragToGapBelow("R", "P2", 0);
  await release();
  expect(await moves()).toEqual([{ id: "R", parent: null, index: 1 }]);

  await load();
  await dragToGapBelow("R", "P2", 1);
  await release();
  expect(await moves()).toEqual([{ id: "R", parent: "P", index: 2 }]);
}, 90_000);

it("u535_first_child_and_clamp", async () => {
  await load();
  await dragToGapBelow("R", "Q", 1);
  await release();
  expect(await moves()).toEqual([{ id: "R", parent: "Q", index: 0 }]);

  await load();
  await dragToGapBelow("R", "P2", 2);
  await release();
  expect(await moves()).toEqual([{ id: "R", parent: "P", index: 2 }]);
}, 90_000);

it("u535_no_drop_into_descendant", async () => {
  await load();

  for (const [below, shift] of [["P1", 1], ["P2", 2]] as const) {
    await dragToGapBelow("P", below, shift);
    await browser("mouse", "move", String(Math.round((await box(`[data-id="${below}"]`)).x) + shift * INDENT + 3), String(Math.round((await box(`[data-id="${below}"]`)).bottom + 2)));
    await browser("press", "Escape");
    await browser("mouse", "up");
    await browser("wait", "--fn", `document.querySelector('[data-id="P"]').dataset.dragging === 'false'`);
  }

  const previews = (await output("Previews")).split(" ");
  expect(previews.some((entry) => /^(P|P1|P2):/.test(entry))).toBe(false);
  expect(await moves()).toEqual([]);
}, 120_000);

it("u535_in_place_reports_nothing", async () => {
  await load();
  await dragToGapBelow("P2", "P1", 0);
  await dragToGapBelow("P2", "P1", 0);
  await release();
  expect(await moves()).toEqual([]);

  await load();
  await dragToGapBelow("P2", "Q", 0);
  await dragToGapBelow("P2", "P1", 1);
  await release();
  expect(await moves()).toEqual([]);
}, 90_000);

it("u535_keyboard_depth", async () => {
  const lift = async () => {
    await load();
    await browser("focus", `[aria-label="Move P2"]`);
    await browser("press", "Space");
    await browser("wait", "--fn", `document.querySelector('[data-id="P2"]').dataset.dragging === 'true'`);
    await browser("press", "ArrowDown");
    await browser("press", "ArrowRight");
  };

  await lift();
  await browser("press", "ArrowLeft");
  await browser("press", "Space");
  await browser("wait", "--fn", `document.querySelector('[aria-label="Moves"]').textContent !== '[]'`);
  expect(await moves()).toEqual([{ id: "P2", parent: null, index: 2 }]);
  expect(await read<string>(`document.activeElement.getAttribute('aria-label')`)).toBe("Move P2");

  await lift();
  await browser("press", "Space");
  await browser("wait", "--fn", `document.querySelector('[aria-label="Moves"]').textContent !== '[]'`);
  expect(await moves()).toEqual([{ id: "P2", parent: "Q", index: 0 }]);
}, 90_000);

it("u535_flat_contract_unchanged", async () => {
  await load("?flat");
  const start = await box(`[aria-label="Move R"]`);
  const target = await box(`[aria-label="Move P"]`);
  await browser("mouse", "move", String(Math.round(start.x)), String(Math.round(start.y)));
  await browser("mouse", "down");
  await browser("mouse", "move", String(Math.round(start.x + 15)), String(Math.round(start.y)));
  await browser("wait", "--fn", `document.querySelector('[data-id="R"]').dataset.dragging === 'true'`);
  await browser("mouse", "move", String(Math.round(target.x)), String(Math.round(target.y)));
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[aria-label="Orders"]').textContent !== ''`);
  expect((await output("Orders")).split(";")).toHaveLength(1);
  expect(await output("Moves")).toBe("[]");
  expect(await output("Previews")).toBe("");
}, 60_000);
