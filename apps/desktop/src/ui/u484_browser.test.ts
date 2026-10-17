import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u484-"));

const session = `u484-${process.pid}`;

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
  await browser("--profile", profile, "open", new URL(new URL("./u484Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html"), origin).href);

}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});


const load = async (dense = false, query = dense ? "?dense" : "") => {
  await browser("open", new URL(`${new URL("./u484Fixture.tsx", import.meta.url).pathname.replace("Fixture.tsx", ".html")}${query}`, origin).href);
  await browser("wait", "--fn", `document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])').length === ${dense ? 40 : 3}`);
};

const order = () => read<string[]>(`[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id)`);

const committed = async (value: string, count = 1) => {
  await browser("wait", "--fn", `document.querySelector('[aria-label="Commits"]').textContent === '${count}'`);
  expect(await read<string>(`document.querySelector('[aria-label="Committed order"]').textContent`)).toBe(value);
  expect((await order()).join(",")).toBe(value);
  expect(await read<string>(`document.querySelector('[aria-label="Commits"]').textContent`)).toBe(String(count));
};

const keyboard = async (id: string) => {
  await browser("focus", `[aria-label="Move ${id}"]`);
  await browser("press", "Space");
  await browser("wait", "--fn", `document.querySelector('[data-id="${id}"]').dataset.dragging === 'true'`);
};

const down = async (expected: string[]) => {
  await browser("press", "ArrowDown");
  await browser("wait", "--fn", `[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id).join(',') === '${expected.join(',')}'`);
};

const drag = async (id: string, target: string) => {
  const point = async (selector: string) => read<{ x: number; y: number }>(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
  const start = await point(`[aria-label="Move ${id}"]`);
  const end = await point(`[aria-label="Move ${target}"]`);
  await browser("mouse", "move", String(Math.round(start.x)), String(Math.round(start.y)));
  await browser("mouse", "down");
  await browser("mouse", "move", String(Math.round(start.x + 15)), String(Math.round(start.y)));
  await browser("wait", "--fn", `document.querySelector('[data-id="${id}"]').dataset.dragging === 'true'`);
  await browser("mouse", "move", String(Math.round(end.x)), String(Math.round(end.y)));
};

it("u484_external_drop", async () => {
  const outside = async () => {
    const point = await read<{ x: number; y: number }>(`(() => { const rect = document.querySelector('[data-outside]').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);

    for (const step of [0.25, 0.5, 0.75, 1]) await browser("mouse", "move", String(Math.round(28 + (point.x - 28) * step)), String(Math.round(20 + (point.y - 20) * step)));
    await browser("wait", "--fn", `document.querySelector('[data-outside]').hasAttribute('data-drop')`);
  };

  const dropped = () => read<string>(`document.querySelector('[aria-label=Dropped]').textContent`);

  await load(false, "?external");
  await drag("A", "A");
  await outside();
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[aria-label=Dropped]').textContent === 'A>Rail'`);
  expect(await read<string>(`document.querySelector('[aria-label=Commits]').textContent`)).toBe("0");
  expect(await read<boolean>(`document.querySelector('[data-outside]').hasAttribute('data-drop')`)).toBe(false);
  expect(await order()).toEqual(["A", "B", "C"]);
  await browser("wait", "--fn", `document.activeElement?.getAttribute('aria-label') === 'Move A'`);

  await load(false, "?external");
  await drag("A", "A");
  await outside();
  await browser("press", "Escape");
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[data-id=A]').dataset.dragging === 'false'`);
  expect(await dropped()).toBe("");
  expect(await read<string>(`document.querySelector('[aria-label=Commits]').textContent`)).toBe("0");
  expect(await read<boolean>(`document.querySelector('[data-outside]').hasAttribute('data-drop')`)).toBe(false);

  await load(false, "?external");
  await drag("A", "C");
  await browser("mouse", "up");
  await committed("B,C,A");
  expect(await dropped()).toBe("");
}, 90_000);

it("u484_keyboard_reorder", async () => {
  await load();
  await keyboard("A");
  await down(["B", "A", "C"]);
  await browser("press", "Space");
  await committed("B,A,C");
  await browser("wait", "--fn", `document.activeElement?.getAttribute('aria-label') === 'Move A'`);
  expect(await read<string>(`document.activeElement.getAttribute('aria-label')`)).toBe("Move A");
}, 60_000);

it("u484_pointer_reorder", async () => {
  await load();
  await drag("A", "C");
  await browser("wait", "--fn", `[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id).join(',') === 'B,C,A'`);
  await browser("mouse", "up");
  await committed("B,C,A");
  await browser("click", '[aria-label="Inspect A"]');
  await browser("wait", "--fn", `document.querySelector('[aria-label=Actions]').textContent === '1'`);
  expect(await read<string>(`document.querySelector('[aria-label=Commits]').textContent`)).toBe("1");
}, 60_000);

it("u484_cancel_without_mutation", async () => {
  for (const input of ["keyboard", "pointer"]) {
    await load();

    if (input === "keyboard") { await keyboard("A"); await down(["B", "A", "C"]); }
    else { await drag("A", "C"); await browser("wait", "--fn", `[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id).join(',') === 'B,C,A'`); }

    await browser("press", "Escape");

    if (input === "pointer") await browser("mouse", "up");
    await browser("wait", "--fn", `[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id).join(',') === 'A,B,C' && document.querySelector('[data-id=A]').dataset.dragging === 'false'`);
    expect(await order()).toEqual(["A", "B", "C"]);
    expect(await read<string>(`document.querySelector('[aria-label=Commits]').textContent`)).toBe("0");
    expect(await read<string>(`document.querySelector('[aria-label="Committed order"]').textContent`)).toBe("A,B,C");

    await browser("wait", "--fn", `document.activeElement?.getAttribute('aria-label') === 'Move A'`);
    expect(await read<string>(`document.activeElement.getAttribute('aria-label')`)).toBe("Move A");
    await keyboard("A"); await down(["B", "A", "C"]);
    await browser("press", "Space"); await committed("B,A,C");
  }
}, 90_000);

it("u484_native_file_drop_coexists", async () => {
  await load();
  expect(await read<boolean>(`(() => {
    const row = document.querySelector('[data-id=A]');
    const transfer = new DataTransfer(); transfer.items.add(new File(['hello'], 'example.txt', {type: 'text/plain'}));
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
    row.dispatchEvent(over); row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return over.defaultPrevented;
  })()`)).toBe(true);
  await browser("wait", "--fn", `document.querySelector('[aria-label=Files]').textContent === 'example.txt'`);
  expect(await read<string>(`document.querySelector('[aria-label=Commits]').textContent`)).toBe("0");
  expect(await read<number>(`document.querySelectorAll('[data-dragging=true]').length`)).toBe(0);
  await keyboard("A"); await down(["B", "A", "C"]);
  await browser("press", "Space"); await committed("B,A,C");
  await drag("B", "C");
  await browser("wait", "--fn", `[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].map(el => el.dataset.id).join(',') === 'A,C,B'`);
  await browser("mouse", "up"); await committed("A,C,B", 2);
}, 90_000);

it("u484_scroll_and_stop", async () => {
  await load(true);
  const initial = Array.from({ length: 40 }, (_, index) => String(index + 1));
  await drag("1", "4");
  const edge = await read<{ x: number; y: number }>(`(() => { const r = document.querySelector('.sortable-fixture').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 2 }; })()`);
  await browser("mouse", "move", String(Math.round(edge.x)), String(Math.round(edge.y)));
  await browser("wait", "--fn", `document.querySelector('.sortable-fixture').scrollTop > 160`);
  expect(await read<boolean>(`document.querySelector('[data-id="8"]').getBoundingClientRect().top < document.querySelector('.sortable-fixture').getBoundingClientRect().bottom`)).toBe(true);
  await browser("press", "Escape");
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('[data-id="1"]').dataset.dragging === 'false' && document.activeElement?.getAttribute('aria-label') === 'Move 1'`);
  expect(await order()).toEqual(initial);
  expect(await read<string>(`document.querySelector('[aria-label=Commits]').textContent`)).toBe("0");
  const stopped = () => read<number[]>(`new Promise(resolve => { const samples = []; const sample = () => { samples.push(document.querySelector('.sortable-fixture').scrollTop); if (samples.length === 10) resolve(samples); else requestAnimationFrame(sample); }; requestAnimationFrame(sample); })`);
  // The scenario explicitly observes constant scrollTop across frames after cancellation/release.
  expect(new Set(await stopped()).size).toBe(1);
  await load(true);
  await drag("1", "4");
  await browser("mouse", "move", String(Math.round(edge.x)), String(Math.round(edge.y)));
  await browser("wait", "--fn", `document.querySelector('.sortable-fixture').scrollTop > 160`);
  await browser("mouse", "move", String(Math.round(edge.x)), String(Math.round(edge.y / 2)));
  await browser("wait", "--fn", `[...document.querySelectorAll('.sortable-fixture > .sortable-row:not([data-dnd-placeholder])')].findIndex(el => el.dataset.id === '1') > 4`);
  expect(new Set(await stopped()).size).toBe(1);
  const preview = await order();
  expect(preview.indexOf("1")).toBeGreaterThan(4);
  await browser("mouse", "up");
  await committed(preview.join(","));
  expect(new Set(await stopped()).size).toBe(1);
  await load(true);
  await keyboard("5");

  for (let index = 0; index < 8; index++) {
    const next = await order();
    const from = next.indexOf("5");
    next.splice(from, 1); next.splice(from + 1, 0, "5");
    await down(next);
  }

  expect(await read<boolean>(`(() => { const row = document.querySelector('[data-id="5"]').getBoundingClientRect(); const box = document.querySelector('.sortable-fixture').getBoundingClientRect(); return row.top >= box.top && row.bottom <= box.bottom; })()`)).toBe(true);
  await browser("press", "Space");
  const final = initial.filter(id => id !== "5"); final.splice(12, 0, "5");
  await committed(final.join(","));
  expect(new Set(await stopped()).size).toBe(1);
}, 90_000);
