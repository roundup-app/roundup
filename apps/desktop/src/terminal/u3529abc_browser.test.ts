import { journal } from "./mouseJournalHarness";
import type { Checks } from "../testing/checks";
import { beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { batch, doubleAt, drag, editor, editorKinds, load, optionDrag, placement, reportingSelection, rightAt, selectRow, setViewport } from "./u514Browser";

beforeAll(setViewport);

// U2680a and U3529b share one Bubble: real pointer selection, then the mode/byte journal.
it.each(["bubble"] as const)("u3529b_terminal_gestures_match_plain_xterm_%s", async where => {
  const selector = await placement(where);

  const from = await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(box.left + 2) + 3, y: Math.round(box.top + 8) };
  })()`);

  await drag(from, { x: from.x + 110, y: from.y });
  const [dragSelection, dragCollapsed] = await read<[string, boolean]>("[window.__emu.selection(), getSelection().isCollapsed]");

  expect(dragSelection).not.toBe("");
  expect(dragCollapsed).toBe(true);
  await doubleAt({ x: from.x + 20, y: from.y });

  const [doubleSelection, doubleCollapsed, before, calls] = await read<[string, boolean, string, number]>(`[
    window.__emu.selection(), getSelection().isCollapsed,
    JSON.stringify([...document.querySelectorAll('.bubble')].map(b => [b.dataset.bubble,b.hidden,b.getAttribute('style')])),
    window.__fake.app.calls.length
  ]`);

  expect(doubleSelection).not.toBe("");
  expect(doubleCollapsed).toBe(true);
  const appOff = await journal(selector, false);
  const appOn = await journal(selector, true);
  const count = appOn.bytes.flat().length;

  await wait(`window.__fake.app.calls.slice(${calls}).filter(c => c.method === 'terminal.write').reduce((n,c) => n + atob(c.params.data).length, 0) === ${count}`);
  expect(await read<number[]>(`window.__fake.app.calls.slice(${calls}).filter(c => c.method === 'terminal.write').flatMap(c => [...atob(c.params.data)].map(ch => ch.charCodeAt(0)))`)).toEqual(appOn.bytes.flat());
  expect(appOn.bytes.length).toBeGreaterThan(0);
  expect(await read<string>("JSON.stringify([...document.querySelectorAll('.bubble')].map(b => [b.dataset.bubble,b.hidden,b.getAttribute('style')]))")).toBe(before);
  expect(await read<number>(`window.__fake.app.calls.slice(${calls}).filter(c => c.method === 'terminal.open').length`)).toBe(0);
  await load("?plain=1");
  expect(await journal("#host .xterm-screen", false)).toEqual(appOff);
  expect(await journal("#host .xterm-screen", true)).toEqual(appOn);

  const { from: selectedFrom, cells } = await reportingSelection(where, 1000);
  await rightAt({ x: Math.round(selectedFrom.x + cells.width * 7), y: selectedFrom.y });
  await batch(
    ["press", "Escape"],
    ["mouse", "move", String(selectedFrom.x), String(selectedFrom.y)],
    ["mouse", "down"],
    ["mouse", "up"]
  );
  expect(await read("window.__emu.selection()")).toBe("");
  const afterCalls = await read<number>("window.__fake.app.calls.length");
  const afterOn = await journal(selector, true);
  await wait(`window.__fake.app.calls.slice(${afterCalls}).filter(c => c.method === 'terminal.write').reduce((n,c) => n + atob(c.params.data).length, 0) === ${afterOn.bytes.flat().length}`);
  expect(await read(`window.__fake.app.calls.slice(${afterCalls}).filter(c => c.method === 'terminal.write').flatMap(c => [...atob(c.params.data)].map(ch => ch.charCodeAt(0)))`)).toEqual(afterOn.bytes.flat());
  await load("?plain&mac");
  expect(await journal("#host .xterm-screen", true)).toEqual(afterOn);
}, 120_000);

it.each([...editorKinds, "pad-source", "diff", "ask"] as const)("u3529a_text_keeps_its_webview_menu_%s", async kind => {
  const selector = await editor(kind);
  const field = kind === "diff" ? "document.querySelector('diffs-container').shadowRoot.querySelector('[data-line]')" : `document.querySelector(${JSON.stringify(selector)})`;

  await browser("eval", `(() => {
    const field = ${field};
    (field.closest('[contenteditable=true]') ?? field).focus();
    window.__textBefore = [...document.querySelectorAll('[role=dialog], [role=menu], .milkdown-toolbar, .milkdown-link-preview[data-show=true], .app-popover')];
    window.__textCalls = window.__fake.app.calls.length;
    if(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
    else { const range = document.createRange(); range.selectNodeContents(field); getSelection().removeAllRanges(); getSelection().addRange(range); }
    const link = field.querySelector('a');
    if (link) { const box = link.getBoundingClientRect(); link.dispatchEvent(new MouseEvent('mousemove', {bubbles:true,buttons:1,clientX:box.left + 2,clientY:box.top + 2})); }
  })()`);

  const selected = await read<string>(`(() => {
    const field = ${field};
    return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value.slice(field.selectionStart, field.selectionEnd) : getSelection().toString();
  })()`);

  const at = await read<{ x: number; y: number }>(`(() => {
    const field = ${field};
    const range = document.createRange(); range.selectNodeContents(field);
    const box = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.getBoundingClientRect() : range.getClientRects()[0];
    return { x: Math.ceil(box.left + 8), y: Math.round(box.top + box.height / 2) };
  })()`);

  await rightAt(at);

  const [context, selection, controls, calls] = await read<[{ cancelled: boolean; editable: boolean }, string, number, number]>(`(() => {
    const field = ${field};
    return [window.__context,
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value.slice(field.selectionStart, field.selectionEnd) : getSelection().toString(),
      [...document.querySelectorAll('[role=dialog], [role=menu], .milkdown-toolbar, .milkdown-link-preview[data-show=true], .app-popover')].filter(e => !window.__textBefore.includes(e)).length,
      window.__fake.app.calls.slice(window.__textCalls).filter(c => c.method === 'message.send').length];
  })()`);

  expect(context.cancelled).toBe(false);
  expect(context.editable).toBe(kind !== "diff");
  expect(selection).toBe(selected);
  expect(controls).toBe(0);
  expect(calls).toBe(0);
}, 90_000);

it.skipIf(!/U3529|U5515|U5549/.test(process.env.ROUNDUP_CAPTURES ?? ""))("u3529c_rendered_selection_and_terminal_menu_removal", async () => {
  const { copyFileSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { captureDir } = await import("../testing/captures");
  const option = process.env.ROUNDUP_CAPTURES?.includes("U5549");
  const ids = option ? ["U5549a", "U5549b", "U5549c", "U5549d"] : process.env.ROUNDUP_CAPTURES?.includes("U5515") ? ["U5515a", "U5515b", "U5515c", "U5515d", "U5515e"] : ["U3529a", "U3529b", "U3529c", "U3529d"];

  for (const phase of process.env.U500_BASE_ROOT ? ["base", "head"] : [process.env.ROUNDUP_CAPTURE_PHASE ?? "head"]) {
  const base = phase === "base";
  const revision = (await promisify(execFile)("git", ["-C", base ? process.env.U500_BASE_ROOT! : process.cwd(), "rev-parse", "HEAD"])).stdout.trim();

  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  const snap = async (step: string) => {
    const first = join(captureDir(ids[0]!)!, phase);

    mkdirSync(first, { recursive: true });
    const shot = join(first, `${step}.png`);

    await browser("screenshot", shot);
    const checks = JSON.stringify({ revision, ...await read<Checks>("window.__checks()") }, null, 2);

    for (const id of ids) {
      const directory = join(captureDir(id)!, phase);

      mkdirSync(directory, { recursive: true });

      if (id !== ids[0]) copyFileSync(shot, join(directory, `${step}.png`));

      writeFileSync(join(directory, `${step}.checks.json`), checks);
    }
  };

  for (const seed of option ? ["agents-10", "bubbles", "tree-40", "tree-40-user"] : ["agents-10", "bubbles", "tree-40"]) {
    const videoDirectory = join(captureDir(ids[0]!)!, phase);

    mkdirSync(videoDirectory, { recursive: true });
    await browser("record", "start", join(videoDirectory, `${seed}-interaction.webm`), url(`${option && !base ? "/src/terminal/u514.html?app&mac&view=workstreams&items=1&tabs=1&" : "/harness.html?"}seed=${seed.replace("-user", "")}&renderer=dom`, base));
    // agent-browser 0.27 retargets its input stream on navigation, not when recording creates a tab.
    await browser("open", await read<string>("location.href"));
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("!!window.__fake && !!document.querySelector('.rail-row')");

    if (seed === "bubbles" || seed.endsWith("-user")) await browser("click", ".terminal-new");
    else await selectRow(seed === "tree-40" ? "migrate" : "agent-4");
    await wait("window.__terminals.size > 0 && !!document.querySelector('.xterm-screen')");
    const output = "\x1b]133;A\x07$ \x1b]133;B\x07printf example\r\n\x1b]133;C\x07alpha bravo charlie\r\n\x1b]133;D;0\x07";

    await browser("eval", `(() => {
      const emulator = [...window.__terminals.values()].at(-1);
      window.__selected = false;
      window.__emu = emulator;
      emulator.write(new TextEncoder().encode(${JSON.stringify(option ? "\x1b[2J\x1b[H" + output + "\x1b[?1002h\x1b[?1006h" : output)}), () => { if (!${option && !base}) emulator.selectTurn(0, false); window.__selected = true; });
    })()`);
    await wait("window.__selected");

    if (option && !base) {
      const coordinates = await read<{from: {x:number;y:number};to:{x:number;y:number}}>("(() => { const box = (document.querySelector('.bubble:not([hidden]) .xterm-screen') ?? document.querySelector('.pane-screen .xterm-screen')).getBoundingClientRect(); const row = box.height/window.__emu.fit().rows; return {from:{x:Math.round(box.left+2),y:Math.round(box.top+row*1.5)},to:{x:Math.round(box.left+150),y:Math.round(box.top+row*1.5)}}; })()");
      await browser("mouse", "move", String(coordinates.from.x), String(coordinates.from.y));
      await optionDrag(coordinates.from, coordinates.to);
    }

    await snap(`${seed}-selected`);
    await browser("eval", "document.querySelector('.pane-screen .xterm-helper-textarea, .bubble:not([hidden]) .xterm-helper-textarea')?.blur()");
    await snap(`${seed}-inactive`);
    const menuPoint = await read<{ x: number; y: number }>("(() => { const box = (document.querySelector('.bubble:not([hidden]) .xterm-screen') ?? document.querySelector('.pane-screen .xterm-screen')).getBoundingClientRect(); return {x: box.left + 30, y: box.top + box.height/window.__emu.fit().rows * 1.5}; })()");
    await rightAt(menuPoint);
    await snap(`${seed}-right-click`);
    await browser("record", "stop");

    if (seed === "tree-40") {
      await browser("press", "Escape");
      await browser("press", "Escape");
      await browser("focus", '[data-id="migrate"]');
      await browser("press", "F2");
      await wait("!!document.querySelector('[data-id=migrate] input')");
      await browser("eval", `(() => {
        window.__fake.failNext(-32003, 'Name changed. Retry.', 'rail.rename');
        const input = document.querySelector('[data-id=migrate] input');
        input.value = 'Renamed';
        input.dispatchEvent(new InputEvent('input', {bubbles:true}));
        input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true}));
      })()`);
      await wait("document.body.textContent.includes('Name changed. Retry.')");

      if (!await read<boolean>("!!document.querySelector('[data-id=migrate] input')")) {
        await browser("focus", '[data-id="migrate"]');
        await browser("press", "F2");
      }

      await wait("!!document.querySelector('[data-id=migrate] input')");
      await browser("eval", "document.querySelector('[data-id=migrate] input').select()");
      await snap('dense-editor-failure');
    }
  }

  await editor("pad", base);
  await browser("dblclick", ".ProseMirror a");
  await snap("pad-selected");
  await browser("dblclick", ".ProseMirror p");
  await read("window.__checks()");

  if (!option && !process.env.ROUNDUP_CAPTURES?.includes("U5515")) {
  const saved = { version: 1, drafts: [{ revision: "retired-selection-note", destination: { surface: "terminal_selection", object: "retired", recipient: "migrate" }, value: { note: "Retained note é 🪁", excerpt: "Original output\nexact Unicode 👩🏽‍💻", source: "retired", terminal: "retired", attempt: null, command: null, cwd: null, exit: null, x: 800, y: 300 }, selection: null, status: "draft", policy: "ordinary" }] };

  await read(`localStorage.setItem('roundup:drafts:/Users/you/harness', ${JSON.stringify(JSON.stringify(saved))})`);
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom", base));
  await wait("!!window.__fake && !!document.querySelector('.rail-row')");
  await read("[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.startsWith('Overview')).dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,button:2}))");
  await read("window.__fake.app.pickMenu(window.__fake.app.menuLabels().find(label => label.startsWith('Recover ')))");
  await wait("!!document.querySelector('.draft-recovery')");
  await snap("retired-note-recovery");
  }
  }
}, 300_000);
