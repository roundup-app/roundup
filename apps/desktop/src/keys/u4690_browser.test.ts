import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u4690-"));

const session = `u4690-${process.pid}`;

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

  origin = server.resolvedUrls.local[0]!;
  const ready = await fetch(new URL("/__roundup_ready", origin));

  if (!ready.ok) throw new Error(await ready.text());
  await browser("--profile", profile, "open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);

  const dir = captureDir("U4690");

  if (dir) {
    mkdirSync(join(dir, "head"), { recursive: true });
    await browser("record", "start", join(dir, "head/interaction.webm"));
  }
}, 90_000);

afterAll(async () => {
  try {
    await browser("close");
  } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

const wait = async (expression: string) => browser("wait", "--fn", expression);

const capture = async (id: string, step: string) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(join(dir, step.includes("/") ? step.slice(0, step.lastIndexOf("/")) : ""), { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read(`window.__checks()`), null, 2));
};

const point = async (selector: string) => read<{ x: number; y: number }>(`(() => {
  const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
})()`);

it("u4690b_pointer_down_keeps_the_leader_choice", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await wait(`!!window.__fake && !!document.querySelector('.rail-row')`);
  await read(`window.__hintSource = document.querySelector('.rail-row'); window.__hintSource.focus()`);
  await wait(`!!document.querySelector('.hint-line [data-hint="⌘K"]:enabled')`);
  await capture("U4690e", "head/normal");
  await browser("click", '.hint-line [data-hint="⌘K"]');
  await wait(`!!document.querySelector('.hint-line.leader')`);
  expect(await read(`document.activeElement === window.__hintSource`)).toBe(true);
  await capture("U4690b", "head/armed");
  const target = await point('.hint-line [data-hint="K"]');
  await browser("mouse", "move", String(target.x), String(target.y));
  await browser("mouse", "down", "left");
  expect(await read(`!!document.querySelector('.hint-line.leader [data-hint="K"]') && document.activeElement === window.__hintSource`)).toBe(true);
  await browser("mouse", "up", "left");
  await wait(`!!document.querySelector('.switcher input') && document.activeElement === document.querySelector('.switcher input')`);
  expect(await read(`window.__fake.app.calls.filter(call => call.method === 'terminal.write')`)).toEqual([]);
  await capture("U4690", "head/switcher");
  await browser("press", "Escape");
  await wait(`!document.querySelector('.switcher')`);

  if (captureDir("U4690")) await browser("record", "stop");
}, 60_000);

it("u4690a_pointer_keeps_source_focus_and_action_destinations", async () => {
  await read(`window.__hintSource.focus()`);
  await wait(`!!document.querySelector('.hint-line [data-hint="⌘/"]:enabled')`);
  const target = await point('.hint-line [data-hint="⌘/"]');
  await browser("mouse", "move", String(target.x), String(target.y));
  await browser("mouse", "down", "left");
  expect(await read(`document.activeElement === window.__hintSource`)).toBe(true);
  await browser("mouse", "up", "left");
  await wait(`!!document.activeElement?.closest('.ask-bar')`);
  await capture("U4690a", "head/ask");
}, 60_000);

it("u4690a_native_button_activation_uses_described_context", async () => {
  await browser("press", "Escape");
  await wait(`!document.activeElement?.closest('.ask-bar')`);

  for (const key of ["Enter", "Space"]) {
    await read(`window.__hintSource.focus()`);
    await wait(`!!document.querySelector('.hint-line [data-hint="⌘K"]:enabled')`);
    await read(`document.querySelector('.hint-line [data-hint="⌘K"]').focus()`);
    await browser("press", key);
    await wait(`!!document.querySelector('.hint-line.leader')`);
    expect(await read(`document.activeElement === window.__hintSource`)).toBe(true);
    await browser("press", "Escape");
    await wait(`!document.querySelector('.hint-line.leader')`);
  }
}, 60_000);

it("u4690d_numbered_group_and_rejected_assignment_keep_the_Todo", async () => {
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
  await wait(`!!window.__fake && !!document.querySelector('.shelf [data-part=branch-control]')`);
  await read(`document.querySelector('.shelf [data-part=branch-control]').click()`);
  await wait(`!!document.querySelector('.shelf .todo-row-button')`);
  await read(`window.__todoSource = document.querySelector('.shelf .todo-row-button'); window.__todoSource.focus()`);
  await wait(`!!document.querySelector('.hint-line [data-hint="Digit9"]:enabled')`);
  await capture("U4690d", "head/numbered");
  await read(`window.__fake.app.handlers['todo.assign'] = () => { throw new Error('Assignment refused: reconnect and retry without losing this Todo'); }`);
  await browser("click", '.hint-line [data-hint="Digit9"]');
  await wait(`document.querySelector('.shelf [role=alert]')?.textContent.includes('Assignment refused')`);
  expect(await read(`document.activeElement === window.__todoSource`)).toBe(true);
  expect(await read(`window.__fake.app.calls.filter(call => call.method === 'todo.assign').length`)).toBe(1);
  await capture("U4690c", "head/rejected");
}, 60_000);

it("u4690a_pointer_picker_returns_to_its_Todo", async () => {
  await read(`window.__todoSource.focus()`);
  await wait(`!!document.querySelector('.hint-line [data-hint="O"]:enabled')`);
  const target = await point('.hint-line [data-hint="O"]');

  await browser("mouse", "move", String(target.x), String(target.y));
  await browser("mouse", "down", "left");
  expect(await read(`document.activeElement === window.__todoSource`)).toBe(true);
  await browser("mouse", "up", "left");
  await wait(`!!document.querySelector('.owner-picker')`);
  await capture("U4690a", "head/picker");
  await browser("press", "Escape");
  await wait(`!document.querySelector('.owner-picker') && document.activeElement === window.__todoSource`);
}, 60_000);

it("u2230b_hint_line_drops_from_the_end", async () => {
  for (const width of [1280, 700]) {
    await browser("set", "viewport", String(width), "800");
    await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
    await wait(`!!document.querySelector('.shelf [data-part=branch-control]')`);
    await read(`document.querySelector('.shelf [data-part=branch-control]').click()`);
    await wait(`!!document.querySelector('.shelf .todo-row-button')`);
    await read(`document.querySelector('.shelf .todo-row-button').focus()`);
    await wait(`document.querySelector('.hint-line').children.length > 0`);
    const hidden = await read<boolean[]>(`[...document.querySelector('.hint-line').children].map(row => row.hidden)`);

    if (width === 700) expect(hidden.some(Boolean)).toBe(true);

    const first = hidden.indexOf(true);

    if (first !== -1) expect(hidden.slice(first).every(Boolean)).toBe(true);
    await read(`const shown = [...document.querySelectorAll('.hint-line button:enabled')].filter(button => !button.closest('[hidden]')); shown.at(-1)?.focus()`);
    await browser("press", "Tab");
    expect(await read(`document.activeElement?.closest('.hint-line [hidden]') !== null`)).toBe(false);
  }
}, 60_000);

it.each(["agent", "bubble", "pad-filled", "pad-side"])("u4690a_pointer_keeps_source_focus_and_action_destinations: %s", async place => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", origin).href);
  await wait(`!!window.__fake && !!document.querySelector('.rail-row[data-id="agent-2"]')`);

  if (place.startsWith("pad-")) {
    await read(`(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); })()`);
    await wait(`!!document.querySelector('.pads-tab [data-part=branch-control]')`);
    await read(`(() => { const group = document.querySelector('.pads-tab [data-part=branch-control]'); if (group.dataset.state === 'closed') group.click(); })()`);
    await wait(`!!document.querySelector('.shelf .pad-name')`);
    await browser("click", ".shelf .pad-name");
    await read(`document.querySelector('.shelf .pad-name').focus()`);
    await browser("press", "Enter");
    await wait(`!!document.querySelector('.pad-body button') && !!document.querySelector('.drawer .ProseMirror')`);
    if (place === "pad-side") {
      await browser("click", '.drawer button[aria-label="Restore"]');
      await wait(`document.querySelector('.drawer').dataset.maximised === 'false'`);
    }
    await read(`window.__padEditor = document.querySelector('.drawer .ProseMirror'); window.__padDraft = window.__padEditor.textContent`);
    await read(`window.__source = document.querySelector('.pad-body button'); window.__source.focus()`);
  } else {
    await browser("click", '.rail-row[data-id="agent-2"]');
    await wait(`!!document.querySelector('.pane-screen textarea')`);

    if (place === "bubble") {
      await browser("click", ".terminal-new");
      await wait(`!!document.querySelector('.bubble textarea')`);
    }

    await read(`window.__source = document.querySelector(${JSON.stringify(place === "bubble" ? ".bubble textarea" : ".pane-screen textarea")}); window.__source.focus()`);
  }

  await wait(`!!document.querySelector('.hint-line [data-hint="⌘K"]:enabled')`);
  await capture("U4690a", `head/${place}-before`);
  const target = await point('.hint-line [data-hint="⌘K"]');
  await browser("mouse", "move", String(target.x), String(target.y));
  await browser("mouse", "down", "left");
  expect(await read(`document.activeElement === window.__source`)).toBe(true);
  await browser("mouse", "up", "left");
  await wait(`!!document.querySelector('.hint-line.leader')`);
  expect(await read(`document.activeElement === window.__source`)).toBe(true);

  if (place.startsWith("pad-")) {
    const choice = await point('.hint-line [data-hint="S"]');
    await browser("mouse", "move", String(choice.x), String(choice.y));
    await browser("mouse", "down", "left");
    expect(await read(`document.activeElement === window.__source && !!document.querySelector('.hint-line.leader')`)).toBe(true);
    await browser("mouse", "up", "left");
    await wait(`!document.querySelector('.hint-line.leader')`);
    expect(await read(`document.querySelector('.window').dataset.shelf`)).toBe("closed");
    expect(await read(`document.querySelector('.drawer').dataset.maximised`)).toBe(place === "pad-filled" ? "true" : "false");
    expect(await read(`document.activeElement === window.__source`)).toBe(true);
    expect(await read(`document.querySelector('.drawer .ProseMirror') === window.__padEditor && window.__padEditor.textContent === window.__padDraft`)).toBe(true);
  }

  expect(await read(`window.__fake.app.calls.filter(call => call.method === 'terminal.write')`)).toEqual([]);
  await capture("U4690a", `head/${place}-focus`);
}, 60_000);
