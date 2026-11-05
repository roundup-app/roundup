import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../testing/captures";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { LINK_CLICK_MS } from "./linkGestures";
import { click, load, move, output, point, settled } from "./linkBrowser";

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

// The shell placement opens a real shell in a Bubble, in addition to centre Agent/Door Terminals.
it.each(["agent", "door", "shell"])("u365_slash_commands_stay_plain_text_%s", async kind => {
  await load(kind);
  await read("window.__fake.app.calls.length = 0");
  const commands = ["/clear", "/context", "/hope:compose", "/word", "/word:word"];
  await output("\x1b[2J\x1b[H" + commands.join("\r\n") + "\r\n/abs/path/a.ts");

  for (let row = 0; row < commands.length; row++) {
    await move(2, row); await click();
    await settled();
  }

  await move(2, commands.length);
  await settled();

  expect(await read("window.__fake.app.attemptedTargets")).toEqual([]);
  expect(await opened()).toEqual([]);
  expect(await read("document.querySelector('[role=alert]')?.textContent ?? ''")).toBe("");
  expect(await read("window.__fake.app.calls.filter(c => ['agent.spawn', 'rail.startDoor', 'agent.prompt', 'ask.send', 'ask.pick', 'message.send', 'terminal.write'].includes(c.method))")).toEqual([]);
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

it.each(["normal", "alternate"])("u365_links_open_in_mouse_reporting_mode_%s", async buffer => {
  await load();

  if (buffer === "alternate") await output("\x1b[?1049h");
  await output("\x1b[2J\x1b[H/tmp/link.ts plain\x1b[?1000h\x1b[?1006h");
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


it.skipIf(!captureDir("U365")).each(process.env.U500_BASE_ROOT ? [true, false] : [false])("u365_rendered_links_and_failures_%s", async base => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  const recording = join(captureDir("U365")!, base ? "base" : "head", "links.webm");
  mkdirSync(join(recording, ".."), {recursive:true});
  await browser("record", "start", recording);
  await browser("set", "media", "dark");

  const capture = async (id: string, name: string) => {
    const directory = join(captureDir(id) ?? join(captureDir("U365")!, "..", id), base ? "base" : "head");
    mkdirSync(directory, {recursive:true});
    const checks = await read<Record<string, {status: string}>>("window.__checks()");
    writeFileSync(join(directory, name + ".checks.json"), JSON.stringify(checks, null, 2));
    expect(Object.entries(checks).filter(([, value]) => value.status === "fail"), name).toEqual([]);
    await browser("screenshot", join(directory, name + ".png"));

    if (id === "U365") {
      const hover = await read("({cursor: getComputedStyle(document.querySelector('.xterm')).cursor, underlines: document.querySelectorAll('.target-underline').length})");
      writeFileSync(join(directory, name + ".hover.json"), JSON.stringify(hover, null, 2));
    }
  };

  for (const [seed, alternate] of [["tree-40", false], ["tree-40", true], ["bubbles", false], ["bubbles", true]] as const) {
    await browser("open", url(`/harness.html?seed=${seed}&renderer=dom`, base));
    await wait("!!window.__fake && !!document.querySelector('.rail-row')");
    const row = seed === "tree-40" ? "payments" : "runner";
    const id = seed === "tree-40" ? "t-payments" : "t-runner";
    await read(`document.querySelector('.rail-row[data-id="${row}"]').click()`);
    await wait(`window.__terminals.has('${id}') && !!document.querySelector('.pane-screen .xterm-screen')`);
    await read(`window.__terminals.get('${id}').ready`);
    const text = "/clear /context /hope:compose /word /word:word src/gone.ts\r\n/tmp/moo-identity/taste/heading-logo-board.png " + Array.from({length:19}, (_,i) => `/tmp/target${i}.ts`).join(" ");
    await read(`new Promise(resolve => window.__terminals.get('${id}').write(new TextEncoder().encode(${JSON.stringify((alternate ? "\x1b[?1049h\x1b[?1000h\x1b[?1006h" : "") + "\x1b[2J\x1b[H" + text)}), resolve))`);
    const p = await read<{x:number;y:number}>("(() => { const b=(document.querySelector('.bubble:not([hidden]) .xterm-screen') ?? document.querySelector('.pane-screen .xterm-screen')).getBoundingClientRect(); return {x:Math.round(b.x+20), y:Math.round(b.y+7)}; })()");
    await browser("mouse", "move", String(p.x), String(p.y));
    await capture("U365", seed + (alternate ? "-alternate" : "") + "-command-hover");
    await read(`window.__u365Emulator = window.__terminals.get('${id}')`);
    await move(2, 1);
    await capture("U365", seed + (alternate ? "-alternate" : "") + "-hover");

    if (seed === "tree-40" && !alternate) {
      await read("(async () => { const {RpcError}=await import('/src/app/seam.ts'); window.__fake.app.openFailure=new RpcError(-32001, 'not found'); })()");
      await move(50, 0); await click();
      await wait("document.querySelector('[role=alert]')?.textContent.includes('src/gone.ts')");
      await capture("U365", "tree-40-missing-path");
    }
  }

  await browser("record", "stop");
  const askDirectory = join(captureDir("U505") ?? join(captureDir("U365")!, "..", "U505"), base ? "base" : "head");
  mkdirSync(askDirectory, {recursive:true});
  await browser("record", "start", join(askDirectory, "links.webm"));
  await browser("set", "media", "dark");

  for (const mode of ["ask"]) {
    await browser("open", url(`/src/terminal/u365.html?mode=${mode}`, base));


    await wait("!!document.querySelector('.ask-row')");
    await capture("U505", mode + "-links");

    await read("(async () => { const {RpcError}=await import('/src/app/seam.ts'); window.__fake.app.openFailure=new RpcError(-32001, 'not found'); })()");
    await browser("click", ".target-link[href=\"src/gone.ts\"]");
    await wait("!!document.querySelector('[role=alert]')");
    await capture("U505", mode + "-missing-path");
    await browser("focus", ".target-link[href='https://example.com']");
    await wait("document.activeElement?.getAttribute('href') === 'https://example.com'");
    await capture("U505", mode + "-focused-url");
    // U505 truncates long Ask text; Tab/focus can still reach its clipped links.
    await browser("focus", ".target-link:last-of-type");
    await browser("press", "Enter");
    await wait("document.querySelector('[role=alert]')?.textContent.includes('missing-directory')");
    await read("document.querySelector('.target-failure').scrollIntoView({block: 'nearest'})");
    await capture("U505", mode + "-long-path-failure");
  }

  await browser("record", "stop");
}, 120_000);
