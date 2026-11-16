import { beforeAll, expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { batch, drag, editor, placement, point, rightAt, setViewport } from "./u514Browser";

beforeAll(setViewport);

it.each(["agent", "user", "bubble"] as const)("u5515a_terminal_right_click_preserves_the_whole_selection_%s", async where => {
  const selector = await placement(where);
  await batch(
    ["eval", String.raw`(() => {
    window.__selectionReady = false;
    window.__emu.write(new TextEncoder().encode('\x1b[2J\x1b[Hcafé alpha bravo charlie\r\n日本語 delta echo foxtrot'), () => { window.__selectionReady = true; });
  })()`],
    ["wait", "--fn", "window.__selectionReady"],
    ["eval", `(() => {
    window.__menuCalls = window.__fake.app.calls.length;
    window.__menuClipboard = window.__fake.app.clipboardWrites.length;
    window.__menuInput = [];
    window.__emu.onInput(bytes => window.__menuInput.push(...bytes));
    window.__menuControls = [...document.querySelectorAll('[role=menu], [role=dialog], .app-popover')];
  })()`]
  );

  const { from, rowHeight } = await read<{ from: { x: number; y: number }; rowHeight: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { from: { x: Math.round(box.left + 2), y: Math.round(box.top + 8) }, rowHeight: box.height / window.__emu.fit().rows };
  })()`);

  await drag(from, { x: from.x + 150, y: from.y + rowHeight });
  const selected = await read<string>("window.__emu.selection()");
  expect(selected).toContain("café alpha bravo charlie\n日本語");
  await rightAt({ x: from.x + 30, y: from.y });

  const [context, selection, selectionBeforeRelease, browserSelection, input, clipboardWrites, calls, controls] = await read<unknown[]>(`[
    window.__context,
    window.__emu.selection(),
    window.__selectionBeforeRelease,
    getSelection().getRangeAt(0).toString(),
    window.__menuInput,
    window.__fake.app.clipboardWrites.length - window.__menuClipboard,
    window.__fake.app.calls.slice(window.__menuCalls).filter(c => ['terminal.write', 'message.send', 'agent.spawn'].includes(c.method)).map(c => c.method),
    [...document.querySelectorAll('[role=menu], [role=dialog], .app-popover')].filter(node => !window.__menuControls.includes(node)).length
  ]`);

  expect(context).toEqual({ editable: false, cancelled: false, selected });
  expect(selection).toBe(selected);
  expect(selectionBeforeRelease).toBe(selected);
  expect(browserSelection).toBe(selected);
  expect(input).toEqual([]);
  expect(clipboardWrites).toBe(0);
  expect(calls).toEqual([]);
  expect(controls).toBe(0);
}, 90_000);

it.each(["agent", "user", "bubble"] as const)("u5515b_terminal_unselected_word_uses_a_readonly_target_%s", async where => {
  const selector = await placement(where);
  const at = await point(selector);

  for (const selected of [false, true]) {
    if (selected) await browser("dblclick", selector);
    await rightAt(at);
    const [editableOrCancelled, contextSelection, terminalSelection] = await read<[boolean, string, string]>("[window.__context.editable || window.__context.cancelled, window.__context.selected, window.__emu.selection()]");

    expect(editableOrCancelled).toBe(false);
    expect(contextSelection).toBe(terminalSelection);
  }
}, 90_000);

it.each(["diff", "code", "readonly-pad"] as const)("u5515c_readonly_text_preserves_selection_and_native_menu_%s", async kind => {
  let field: string;

  if (kind === "diff") {
    await editor("diff");
    field = "document.querySelector('diffs-container').shadowRoot.querySelector('[data-line]')";
  } else {
    await browser("open", url("/src/terminal/u5515.html"));

      field = `document.querySelector('.ProseMirror[contenteditable=false] ${kind === "code" ? "pre code" : "p"}')`;
  }

  await wait(`!!(${field})`);

  const from = await read<{ x: number; y: number }>(`(() => {
    const range = document.createRange(); range.selectNodeContents(${field});
    const walker = document.createTreeWalker(${field}, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (text) range.selectNodeContents(text);
    const box = range.getClientRects()[0];
    return { x: Math.ceil(box.left + 1), y: Math.round(box.top + box.height / 2) };
  })()`);

  await drag(from, { x: from.x + 95, y: from.y });
  const selected = await read<string>("getSelection().toString()");
  expect(selected).toContain(" ");
  await rightAt({ x: from.x + 20, y: from.y });
  expect(await read("window.__context")).toEqual({ editable: false, cancelled: false, selected });
  await browser("click", ".traffic-lights");
  await rightAt(from);
  expect(await read<boolean>("window.__context.editable || window.__context.cancelled")).toBe(false);
}, 90_000);

it.each(["agent", "user", "bubble"] as const)("u5515d_terminal_input_survives_readonly_context_menu_%s", async where => {
  const selector = await placement(where);

  const at = await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(box.left + 2), y: Math.round(box.top + 8) };
  })()`);

  await drag(at, { x: at.x + 150, y: at.y });
  const selected = await read<string>("window.__emu.selection()");
  expect(selected).toContain(" ");
  await rightAt({ x: at.x + 30, y: at.y });
  // Headless Chromium opens no OS menu: the next key follows the completed gesture.
  await batch(
    ["press", "Meta+c"],
    ["wait", "--fn", "window.__fake.app.clipboardWrites.length === 1"]
  );
  expect(await read<string[]>("window.__fake.app.clipboardWrites")).toEqual([selected]);
  await batch(
    ["eval", `(() => {
    window.__inputStart = window.__fake.app.calls.length;
    window.__input = [];
    window.__emu.onInput(bytes => window.__input.push(...bytes));
    window.__inputReady = false;
    window.__emu.write(new TextEncoder().encode('\\x1b[?2004h'), () => { window.__inputReady = true; });
  })()`],
    ["wait", "--fn", "window.__inputReady"],
    ["press", "a"],
    ["wait", "--fn", "window.__input.length === 1"],
    ["eval", `(() => {
    const input = document.activeElement;
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true,composed:true,key:'Process',keyCode:229,isComposing:true}));
    input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true,data:''}));
    input.dispatchEvent(new CompositionEvent('compositionupdate', {bubbles:true,data:'n'}));
    input.value = 'n';
    input.dispatchEvent(new InputEvent('input', {bubbles:true,composed:true,isComposing:true,inputType:'insertCompositionText',data:'n'}));
  })()`]
  );
  expect(await read<number[]>("window.__input")).toEqual([97]);
  await batch(
    ["eval", `(() => {
    const input = document.activeElement;
    input.dispatchEvent(new CompositionEvent('compositionupdate', {bubbles:true,data:'日本語'}));
    input.value = '日本語';
    input.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true,data:'日本語'}));
    input.dispatchEvent(new InputEvent('input', {bubbles:true,composed:true,isComposing:false,inputType:'insertText',data:'日本語'}));
    input.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true,composed:true,key:'Process',keyCode:229}));
  })()`],
    ["wait", "--fn", "new TextDecoder().decode(new Uint8Array(window.__input)) === 'a日本語'"],
    // Chromium on Linux reserves Ctrl+V for the program; its native paste chord is Ctrl+Shift+V.
    ["clipboard", "write", "pasted text"],
    ["press", "Control+Shift+V"],
    ["wait", "--fn", "new TextDecoder().decode(new Uint8Array(window.__input)).includes('pasted text')"]
  );
  const expected = "a日本語\x1b[200~pasted text\x1b[201~";
  expect(await read<string>("new TextDecoder().decode(new Uint8Array(window.__input))")).toBe(expected);
  await wait(`window.__fake.app.calls.slice(window.__inputStart).filter(c => c.method === 'terminal.write').reduce((n,c) => n + atob(c.params.data).length, 0) === ${new TextEncoder().encode(expected).length}`);
}, 90_000);
