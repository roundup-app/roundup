import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { LINK_CLICK_MS } from "./linkGestures";

const load = async (kind = "agent") => {
  const seed = kind === "agent" ? "agents-10" : "tree-40";
  const row = kind === "agent" ? "agent-3" : "payments";
  const id = kind === "agent" ? "t-agent-3" : "t-payments";
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url(`/harness.html?seed=${seed}&renderer=dom`));
  await wait(`!!window.__fake && !!document.querySelector('.rail-row[data-id="${row}"]')`);
  await read(`document.querySelector('.rail-row[data-id="${row}"]').click()`);
  await wait(`window.__terminals.has('${id}') && !!document.querySelector('.pane-screen .xterm-screen')`);
  await read(`window.__u365Emulator = window.__terminals.get('${id}'); window.__u365Emulator.ready`);

  if (kind === "shell") {
    await browser("click", ".terminal-new");
    await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen')");
    await read("window.__u365Emulator = window.__terminals.get(document.querySelector('.bubble:not([hidden])').dataset.bubble); window.__u365Emulator.ready");
  }
};

const output = async (text: string) => {
  await read(`new Promise(resolve => window.__u365Emulator.write(new TextEncoder().encode(${JSON.stringify(text)}), resolve))`);
  await read("new Promise(resolve => requestAnimationFrame(resolve))");
};

const point = async (col = 2, row = 0) => read<{ x: number; y: number }>(`(() => {
  const box = (document.querySelector('.bubble:not([hidden]) .xterm-screen') ?? document.querySelector('.pane-screen .xterm-screen')).getBoundingClientRect();
  const size = window.__u365Emulator.serialize();
  return { x: Math.round(box.x + (${col} + .5) * box.width / size.cols), y: Math.round(box.y + (${row} + .5) * box.height / size.rows) };
})()`);

const move = async (col = 2, row = 0) => {
  const p = await point(col, row);
  await browser("mouse", "move", String(p.x), String(p.y));
};

const click = async () => { await browser("mouse", "down"); await browser("mouse", "up"); };

// An observation window bounds absence after the application's click-disambiguation timer.
const settled = () => read(`new Promise(resolve => setTimeout(resolve, ${LINK_CLICK_MS + 50}))`);

const opened = () => read("window.__fake.app.openedTargets");

it.each(["agent", "door", "shell"])("u365_plain_click_opens_once_%s", async kind => {
  await load(kind);
  await output("\x1b[2J\x1b[H/abs/path/a.ts https://example.com");
  await move(); await click();
  await wait("window.__fake.app.openedTargets.length === 1");
  await move(17); await click();
  await wait("window.__fake.app.openedTargets.length === 2");
  expect(await opened()).toEqual([{ kind: "path", path: "/abs/path/a.ts", line: null }, { kind: "url", url: "https://example.com" }]);
}, 60_000);

it("u365_drag_selects_without_opening", async () => {
  await load(); await output("\x1b[2J\x1b[H/abs/path/a.ts");
  await move(1); await browser("mouse", "down"); await move(10); await browser("mouse", "up");
  await settled();
  expect(await read("window.__u365Emulator.selection()")).not.toBe("");
  expect(await opened()).toEqual([]);
}, 60_000);

it("u365_double_click_selects_without_opening", async () => {
  await load(); await output("\x1b[2J\x1b[H/abs/path/a.ts");
  const p = await point();
  // agent-browser dblclick sends a native two-click sequence.
  await browser("mouse", "move", String(p.x), String(p.y));
  await browser("dblclick", ".pane-screen .xterm-rows > div:first-child span:first-child");
  await settled();
  expect(await read("window.__u365Emulator.selection()")).not.toBe("");
  expect(await opened()).toEqual([]);
}, 60_000);

it("u365_stationary_hover_tracks_output_scroll_and_resize", async () => {
  await load(); await output("\x1b[2J\x1b[Hplain text"); await move();
  await output("\x1b[H/tmp/new.ts"); await click();
  await wait("window.__fake.app.openedTargets.length === 1");
  await output("\x1b[2;1H/tmp/scrolled.ts\x1b[S"); await click();
  await wait("window.__fake.app.openedTargets.length === 2");
  await output("\x1b[H\x1b[2K/tmp/next.ts");
  await read("(() => { const e = window.__u365Emulator; const size = e.serialize(); e.setSize({cols: size.cols - 5, rows: size.rows}); })()");
  await click(); await wait("window.__fake.app.openedTargets.length === 3");
  await output("\x1b[Hplain words      "); await click(); await settled();
  expect(await opened()).toEqual([{ kind: "path", path: "/tmp/new.ts", line: null }, { kind: "path", path: "/tmp/scrolled.ts", line: null }, { kind: "path", path: "/tmp/next.ts", line: null }]);
}, 60_000);

it("u365_links_open_in_mouse_reporting_mode", async () => {
  await load(); await output("\x1b[2J\x1b[H/tmp/link.ts plain\x1b[?1000h\x1b[?1006h");
  await read("window.__fake.app.calls.length = 0");
  await move(); await click(); await wait("window.__fake.app.openedTargets.length === 1");
  expect(await read("window.__fake.app.calls.filter(c => c.method === 'terminal.write')")).toEqual([]);
  await move(15); await click();
  await wait("window.__fake.app.calls.some(c => c.method === 'terminal.write')");
  expect(await opened()).toEqual([{ kind: "path", path: "/tmp/link.ts", line: null }]);
}, 60_000);


it("u365_wrapped_targets_open_from_each_row_without_punctuation", async () => {
  await load();
  const cols = await read<number>("window.__u365Emulator.serialize().cols");
  const path = "/tmp/" + "a".repeat(cols + 15) + ".ts";
  await output("\x1b[2J\x1b[H" + path + ", next");
  await move(2, 0); await click(); await wait("window.__fake.app.openedTargets.length === 1");
  await move(2, 1); await click(); await wait("window.__fake.app.openedTargets.length === 2");
  await move(path.length - cols, 1); await click(); await settled();
  expect(await opened()).toEqual([{ kind: "path", path, line: null }, { kind: "path", path, line: null }]);
}, 60_000);


it.skipIf(!captureDir("U365"))("u365_rendered_links_and_failures", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    const capture = async (id: string, name: string) => {
      const directory = join(captureDir(id) ?? join(captureDir("U365")!, "..", id), base ? "base" : "head");
      mkdirSync(directory, {recursive:true});
      const checks = await read<Record<string, {status: string}>>("window.__checks()");
      writeFileSync(join(directory, name + ".checks.json"), JSON.stringify(checks, null, 2));
      expect(Object.entries(checks).filter(([, value]) => value.status === "fail"), name).toEqual([]);
      await browser("screenshot", join(directory, name + ".png"));
    };

    for (const seed of ["tree-40", "bubbles"]) {
      await browser("open", url(`/harness.html?seed=${seed}&renderer=dom`, base));
      await wait("!!window.__fake && !!document.querySelector('.rail-row')");
      const row = seed === "tree-40" ? "payments" : "runner";
      const id = seed === "tree-40" ? "t-payments" : "t-runner";
      await read(`document.querySelector('.rail-row[data-id="${row}"]').click()`);
      await wait(`window.__terminals.has('${id}') && !!document.querySelector('.pane-screen .xterm-screen')`);
      await read(`window.__terminals.get('${id}').ready`);
      const text = "/tmp/moo-identity/taste/heading-logo-board.png " + Array.from({length:19}, (_,i) => `/tmp/target${i}.ts`).join(" ");
      await read(`new Promise(resolve => window.__terminals.get('${id}').write(new TextEncoder().encode(${JSON.stringify("\x1b[2J\x1b[H" + text)}), resolve))`);
      const p = await read<{x:number;y:number}>("(() => { const b=(document.querySelector('.bubble:not([hidden]) .xterm-screen') ?? document.querySelector('.pane-screen .xterm-screen')).getBoundingClientRect(); return {x:Math.round(b.x+20), y:Math.round(b.y+7)}; })()");
      await browser("mouse", "move", String(p.x), String(p.y));
      await capture("U365", seed + "-hover");
    }

    for (const mode of ["ask", "message"]) {
      await browser("open", url(`/src/terminal/u365.html?mode=${mode}`, base));

      if (mode === "message") {
        await wait("!!document.querySelector('[data-reaction-opener]')");
        await browser("click", "[data-reaction-opener]");
        await wait("!!document.querySelector('[data-firing-message]')");
        await browser("click", "[data-firing-message]");
      }

      await wait(mode === "ask" ? "!!document.querySelector('.ask-row')" : "!!document.querySelector('section[aria-label=Message] .reaction-instruction')");
      await capture(mode === "ask" ? "U505" : "NR9", mode + "-links");

      if (!base) {
        await read("(async () => { const {RpcError}=await import('/src/app/seam.ts'); window.__fake.app.openFailure=new RpcError(-32001, 'not found'); })()");
        await browser("click", ".target-link:first-of-type");
        await wait("!!document.querySelector('[role=alert]')");
        await capture(mode === "ask" ? "U505" : "NR9", mode + "-missing-path");
      }
    }
  }
}, 120_000);
