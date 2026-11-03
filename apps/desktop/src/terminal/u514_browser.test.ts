import { journal } from "./mouseJournalHarness";
import type { Checks } from "../testing/checks";
import { beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browser, read, url, wait } from "../ui/tabsBrowser";

beforeAll(async () => { await browser("set", "viewport", "1512", "950"); });

// CI5527e: the rejected head spent 330091 ms driving these same sequential commands.
// The installed CLI batches them without changing the session, inputs or readiness bounds.
const batch = (...commands: string[][]) => browser("batch", "--bail", ...commands.map(command => command.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ")));

const load = async (query = "") => {
  await batch(
    ["open", url(`/src/terminal/u514.html${query}`)],
    ["wait", "--fn", "document.body.dataset.ready === '1' && document.querySelectorAll('.turn-gutter').length >= 0"]
  );
};

it("u514_browser_the_gutters_select_turns", async () => {
  await load();
  await batch(
    ["wait", "--fn", "document.querySelectorAll('.turn-gutter').length === 3"],
    ["click", ".turn-gutter:first-of-type"]
  );
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1");
  await browser("eval", "document.querySelectorAll('.turn-gutter')[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))");
  expect(await read<string>("window.__emu.selection()")).toBe("$ one\n1\n$ two\n2\n$ three\n3");

  await load("?marks=none");
  expect(await read<number>("document.querySelectorAll('.turn-gutter').length")).toBe(0);
}, 90_000);

it.each([false, true])("u2680b_a_click_clears_browser_and_terminal_selections_stopped_%s", async (stopped) => {
  await load();
  await browser("eval", `(() => {
    const target = document.createElement('button');
    target.textContent = 'Outside terminal';
    target.id = 'outside';
    target.onpointerdown = event => { ${stopped ? 'event.preventDefault(); event.stopPropagation();' : ''} };
    document.body.append(target);
    window.__emu.selectTurn(0, false);
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection().addRange(range);
  })()`);
  expect(await read<string>("window.__emu.selection()")).not.toBe("");
  await browser("click", "#outside");
  expect(await read<{ terminal: string; browser: boolean }>("({ terminal: window.__emu.selection(), browser: getSelection().isCollapsed })")).toEqual({ terminal: "", browser: true });
}, 90_000);

const app = async (base = false, mac = false) => {
  const seed = process.env.ROUNDUP_CAPTURES ? "tree-40" : "selection";

  await batch(
    ["eval", "localStorage.clear()"],
    ["open", url(mac ? `/src/terminal/u514.html?app&mac&seed=${seed}&renderer=dom&view=workstreams&items=1&tabs=1` : `/harness.html?seed=${seed}&renderer=dom`, base)],
    ["wait", "--fn", "!!document.querySelector('.shelf-tabs')"]
  );
};

const selectRow = async (id: string) => {
  await batch(
    ["focus", `.rail-row[data-id="${id}"]`],
    ["wait", "--fn", `document.activeElement?.matches('.rail-row[data-id="${id}"]')`],
    ["press", "Enter"],
    ["wait", "--fn", `document.querySelector('.rail-row[data-id="${id}"]')?.dataset.selected === 'true'`]
  );
};

const point = (selector: string, end = false) => read<{ x: number; y: number }>(`(() => {
  const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.round(${end ? 'box.right - 2' : 'box.left + 2'}), y: Math.round(box.top + box.height / 2) };
})()`);

const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
  await batch(
    ["mouse", "move", String(from.x), String(from.y)],
    ["mouse", "down"],
    ...Array.from({ length: 5 }, (_, index) => {
      const step = index + 1;

      return ["mouse", "move", String(Math.round(from.x + (to.x - from.x) * step / 5)), String(Math.round(from.y + (to.y - from.y) * step / 5))];
    }),
    ["mouse", "up"]
  );
};

// agent-browser's input stream supports a click count at a text coordinate, including WebGL cells.
const doubleAt = async (at: { x: number; y: number }) => {
  // SAFETY: this isolated agent-browser returns its documented stream status with a numeric port.
  const status = JSON.parse(await browser("stream", "status")) as { data: { port: number } };
  await browser("eval", "window.__doubleClicked = false; document.addEventListener('dblclick', () => { window.__doubleClicked = true; }, { once: true, capture: true })");
  // Node's WebSocket avoids jsdom's browser-origin policy on this local agent-browser stream.
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    const socket = new WebSocket('ws://127.0.0.1:' + process.argv[1]);
    socket.onerror = () => process.exit(1);
    socket.onopen = () => {
      const at = JSON.parse(process.argv[2]);
      for (const clickCount of [1, 2]) for (const eventType of ['mousePressed', 'mouseReleased']) socket.send(JSON.stringify({ type: 'input_mouse', eventType, ...at, button: 'left', clickCount }));
      socket.close();
    };
  `, String(status.data.port), JSON.stringify(at)], { timeout: 10_000 });
  await wait("window.__doubleClicked === true");
};

// Every surface shares the one `user-select: none` chrome rule, so one title-bar, one Rail and one Shelf surface represent it.
const chromeSurfaces = [".window-title", '[data-id="migrate"] .name', ".shelf-tabs"];

it.each(["drag", "double-click"])(
  "u2680c_chrome_drag_and_double_click_leave_no_browser_selection_%s", async gesture => {
    await app();

    for (const surface of chromeSurfaces) {
      await wait(`!!document.querySelector(${JSON.stringify(surface)})`);

      if (gesture === "drag") await drag(await point(surface), await point(surface, true));
      else await browser("dblclick", surface);

      expect(await read<boolean>("getSelection().isCollapsed"), surface).toBe(true);
    }
  }, 60_000);

it.each(["pane-across-shelf", "blank-bubbles-into-pane"])("u2680c_chrome_drag_and_double_click_leave_no_browser_selection_%s", async (surface) => {
  const selector = await placement("bubble");

  const from = surface === "pane-across-shelf" ? await point(".pane") : await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.ceil(box.right + 20), y: Math.round(box.top + 8) };
  })()`);

  await drag(from, await point(surface === "pane-across-shelf" ? ".shelf" : ".pane"));
  expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
}, 90_000);

const placement = async (where: "agent" | "door" | "user" | "bubble", mac = false, text = "alpha bravo charlie ".repeat(256)) => {
  await app(false, mac);

  if (where === "bubble" || where === "user") {
    if (where === "bubble") await selectRow("payments");
    await browser("click", ".terminal-new");
  } else await selectRow(where === "agent" ? "migrate" : "payments");

  const selector = where === "bubble" || where === "user" ? ".bubble:not([hidden]) .xterm-screen" : ".pane-screen .xterm-screen";

  await batch(
    ["wait", "--fn", `!!document.querySelector(${JSON.stringify(selector)})`],
    ["eval", String.raw`(() => {
    const id = ${where === 'bubble' || where === 'user' ? "document.querySelector('.bubble:not([hidden])').dataset.bubble" : JSON.stringify(where === 'agent' ? 't-migrate' : 't-payments')};
    window.__emu = window.__terminals.get(id);
    window.__emu.write(new TextEncoder().encode('\x1b[2J\x1b[H' + ${JSON.stringify(text)}), () => { window.__selectionReady = true; });
  })()`],
    ["wait", "--fn", "window.__selectionReady === true"]
  );

  return selector;
};

it.each(["agent", "bubble"] as const)("u2680a_terminal_boundaries_never_create_browser_selection_%s", async (where) => {
  const selector = await placement(where);

  const points = await read<{ output: { x: number; y: number }; inset: { x: number; y: number }; strip: { x: number; y: number }; after: { x: number; y: number } }>(`(() => {
    const screen = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const host = document.querySelector(${JSON.stringify(selector)}).closest('.pane-screen, .bubble-body').getBoundingClientRect();
    return { output: { x: Math.round(screen.left + 20), y: Math.round(screen.top + 8) },
      inset: { x: Math.round(host.left + 1), y: Math.round(host.top + 12) },
      strip: { x: Math.round(screen.left + 20), y: Math.floor(host.bottom - 1) },
      after: { x: Math.floor(screen.right - 1), y: Math.round(screen.top + 8) } };
  })()`);

  const outside = await point(".rail");

  for (const area of [points.inset, points.strip, points.after, outside]) {
    await drag(points.output, area);
    expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);

    if (where === "bubble" && await read<boolean>("!document.querySelector('.bubble:not([hidden])')")) await browser("click", ".terminal-tab");
    await drag(area, points.output);
    expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);

    if (where === "bubble" && await read<boolean>("!document.querySelector('.bubble:not([hidden])')")) await browser("click", ".terminal-tab");
  }
}, 180_000);

// Remounting the App per target dominated this sweep; reseed selections on the same emulator instead.
it.each(["agent", "bubble"] as const)("u2680b_a_click_clears_browser_and_terminal_selections_%s", async where => {
  const selector = await placement(where);

  const targets = where === "agent" ? ["output", "inset", ".window-title"]
    : ["output", ".bubble-header", '.bubble-zone[data-zone="se"]'];

  for (const target of targets) {
    await browser("dblclick", selector);
    expect(await read<string>("window.__emu.selection()"), target).not.toBe("");
    await browser("eval", "(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.window-title')); getSelection().removeAllRanges(); getSelection().addRange(range); })()");

    const at = target === "inset" ? await read<{ x: number; y: number }>(`(() => {
      const host = document.querySelector(${JSON.stringify(selector)}).closest('.pane-screen, .bubble-body').getBoundingClientRect();
      return { x: Math.round(host.left + 1), y: Math.round(host.top + 12) };
    })()`) : await point(target === "output" ? selector : target);

    await batch(
      ["mouse", "move", String(at.x), String(at.y)],
      ["mouse", "down"],
      ["mouse", "up"]
    );
    expect(await read<{ terminal: string; browser: boolean }>("({ terminal: window.__emu.selection(), browser: getSelection().isCollapsed })"), target).toEqual({ terminal: "", browser: true });
  }
}, 60_000);

const editorKinds = ["pad", "rename"] as const;

const editor = async (kind: typeof editorKinds[number] | "pad-source" | "diff" | "ask", base = false) => {
  if (kind === "diff") await browser("eval", "localStorage.clear()");
  else await app(base);

  let selector: string;

  if (kind === "ask") {
    await browser("click", "[data-todo-root]");
    selector = 'textarea[aria-label="Ask"]';
    await batch(
      ["wait", "--fn", `!!document.querySelector(${JSON.stringify(selector)})`],
      ["fill", selector, "Keep this selected draft"]
    );
  } else if (kind === "diff") {
    await batch(
      ["open", url("/src/changes/u2540.html")],
      ["wait", "--fn", "!!document.querySelector('.worktree-control')"],
      ["click", ".worktree-control"],
      ["wait", "--fn", "!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-type=file]')"],
      ["eval", "document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').click()"],
      ["find", "role", "button", "click", "--name", "View diff", "--exact"],
      ["wait", "--fn", "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')"]
    );
    selector = ".diff-content";
  } else if (kind === "pad" || kind === "pad-source") {
    const source = kind === "pad-source" ? "```mermaid\ngraph LR\nA-->B\n```" : "alpha [bravo](https://example.com) charlie delta echo foxtrot";

    await browser("eval", `window.__fake.app.rpc('pad.write', { name: 'pad-3', text: ${JSON.stringify(source)} })`);
    await selectRow("payments");
    await batch(
      ["click", "#shelf-tab-pads"],
      ["wait", "--fn", "document.querySelector('#shelf-tab-pads')?.getAttribute('aria-selected') === 'true'"],
      ["wait", "--fn", "document.querySelector('.pads-tab [data-shelf-group=unassigned] [data-part=branch-control]')?.checkVisibility()"],
    ["eval", "document.querySelector('.pads-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()"],
      ["wait", "--fn", "document.querySelector('[data-pad=pad-3] .pad-name')?.textContent === 'pad-3'"],
      ["eval", "document.querySelector('[data-pad=pad-3] .pad-name').focus()"],
      ["wait", "--fn", "document.activeElement?.matches('.pad-name')"],
      ["press", "Enter"],
      ["wait", "--fn", "!!document.querySelector('.ProseMirror[contenteditable=true]')"]
    );
    selector = ".ProseMirror";

    if (kind === "pad-source") {
      await batch(
        ["wait", "--fn", "!!document.querySelector('.visual-block')"],
        ["click", ".visual-block"],
        ["wait", "--fn", "!!document.querySelector('.visual-source.is-open')"]
      );
      selector = ".visual-source.is-open";
    }
  } else {
    await browser("dblclick", '[data-id="migrate"] .name');
    selector = '[data-id="migrate"] input';
  }

  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);

  return selector;
};

// The copy path is shared; the rich editor takes a double-click and the plain input a drag.
it.each([{ kind: "pad", gesture: "double-click" }, { kind: "rename", gesture: "drag" }] as const)("u2680d_editors_keep_native_selection_and_copy_$kind ($gesture)", async ({ kind, gesture }) => {
  const selector = await editor(kind);
  const before = await read<string>(`document.querySelector(${JSON.stringify(selector)}).value ?? document.querySelector(${JSON.stringify(selector)}).textContent`);

  if (gesture === "drag") {
    // Rename initially selects its full name; collapse it before starting a new pointer selection.
    await batch(
      ["wait", "--fn", `document.activeElement === document.querySelector(${JSON.stringify(selector)})`],
      ["press", "Home"],
      ["wait", "--fn", `document.querySelector(${JSON.stringify(selector)}).selectionStart === document.querySelector(${JSON.stringify(selector)}).selectionEnd`]
    );

    const from = await read<{ x: number; y: number }>(`(() => {
      const editor = document.querySelector(${JSON.stringify(selector)});
      const box = (editor.querySelector('p') ?? editor).getBoundingClientRect();
      return { x: Math.round(box.left + 4), y: Math.round(box.top + (editor.matches('input, textarea') ? box.height / 2 : 8)) };
    })()`);

    await drag(from, { x: from.x + 25, y: from.y });
  } else if (kind === "pad") {
    const at = await read<{ x: number; y: number }>("(() => { const box = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: Math.round(box.left + 15), y: Math.round(box.top + 8) }; })()");

    await doubleAt(at);
  } else await browser("dblclick", selector);

  const text = await read<string>(`(() => {
    const editor = document.querySelector(${JSON.stringify(selector)});
    window.__editor = editor;
    return editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : getSelection().toString();
  })()`);

  expect(text, `${kind} ${gesture}`).not.toBe("");
  await browser("clipboard", "copy");
  const selected = "window.__editor instanceof HTMLInputElement || window.__editor instanceof HTMLTextAreaElement ? window.__editor.value.slice(window.__editor.selectionStart, window.__editor.selectionEnd) : getSelection().toString()";

  expect(await read<string>(selected)).not.toBe("");
  await browser("click", ".window-title");
  expect(await read<string>(selected)).toBe("");
  expect(await read<string>("window.__editor.value ?? window.__editor.textContent")).toBe(before);
  await batch(
    ["eval", "(() => { const input = document.createElement('input'); input.id = 'copy-result'; input.style.position = 'fixed'; input.style.top = '50px'; document.body.append(input); input.focus(); })()"],
    ["press", "Control+V"]
  );
  expect(await read<string>("document.querySelector('#copy-result').value"), `${kind} ${gesture}`).toBe(text);
  await browser("eval", "document.querySelector('#copy-result').remove(); window.__editor.focus()");

}, 120_000);

it("u2680b_minimising_and_restoring_does_not_restore_selection", async () => {
  const selector = await placement("bubble");
  await browser("dblclick", selector);
  expect(await read<string>("window.__emu.selection()")).not.toBe("");
  await batch(
    ["click", ".window-title"],
    ["wait", "--fn", "!document.querySelector('.bubble:not([hidden])')"]
  );
  expect(await read<string>("window.__emu.selection()")).toBe("");
  await batch(
    ["click", ".terminal-tab"],
    ["wait", "--fn", "!!document.querySelector('.bubble:not([hidden])')"]
  );
  expect(await read<string>("window.__emu.selection()")).toBe("");
}, 90_000);


it("u2680c_readonly_content_keeps_native_selection_and_copy_pad", async () => {
  await app();
  await selectRow("agent-1");
  await batch(
    ["click", "#shelf-tab-pads"],
    ["wait", "--fn", "document.querySelector('#shelf-tab-pads')?.getAttribute('aria-selected') === 'true'"],
    ["wait", "--fn", "document.querySelector('.pads-tab [data-shelf-group=unassigned] [data-part=branch-control]')?.checkVisibility()"],
    ["eval", "document.querySelector('.pads-tab [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()"],
    ["wait", "--fn", "document.querySelector('[data-pad=pad-0] .pad-name')?.textContent === 'pad-0'"],
    ["eval", "document.querySelector('[data-pad=pad-0] .pad-name').focus()"],
    ["wait", "--fn", "document.activeElement?.matches('.pad-name')"],
    ["press", "Enter"]
  );
  const selector = '.pad-rich-editor .ProseMirror p';

  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);

  const from = await read<{ x: number; y: number }>(`(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(${JSON.stringify(selector)}));
    const box = range.getClientRects()[0];
    return { x: Math.ceil(box.left + 1), y: Math.round(box.top + box.height / 2) };
  })()`);

  await drag(from, { x: from.x + 55, y: from.y });
  const text = await read<string>("getSelection().toString()");

  expect(text).not.toBe("");
  await batch(
    ["clipboard", "copy"],
    ["eval", "(() => { const input = document.createElement('input'); input.id = 'copy-result'; input.style.position = 'fixed'; input.style.top = '50px'; document.body.append(input); input.focus(); })()"],
    ["press", "Control+V"]
  );
  expect(await read<string>("document.querySelector('#copy-result').value")).toBe(text);
}, 120_000);

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

const rightAt = async (at: { x: number; y: number }) => {
  await batch(
    ["eval", `(() => {
    window.__context = null;
    document.addEventListener('contextmenu', event => {
      const path = event.composedPath();
      window.__contextEvent = event; window.__context = {
        editable: path.some(node => node instanceof HTMLElement && (node.isContentEditable || node.matches('input, textarea'))),
        cancelled: event.defaultPrevented,
        selected: getSelection().toString(),
      };
    }, { once: true, capture: true });
  })()`],
    ["mouse", "move", String(at.x), String(at.y)],
    ["mouse", "down", "right"],
    ["eval", "window.__selectionBeforeRelease = getSelection().rangeCount ? getSelection().getRangeAt(0).toString() : ''"],
    ["mouse", "up", "right"],
    ["wait", "--fn", "window.__context !== null"],
    ["eval", "window.__context.cancelled = window.__contextEvent.defaultPrevented; window.__context.selected = getSelection().toString()"]
  );
};

// agent-browser's mouse CLI omits pressed modifiers; its input stream carries them.
const optionDrag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
  // SAFETY: the isolated browser exposes its documented numeric stream port.
  const status = JSON.parse(await browser("stream", "status")) as { data: { port: number } };
  await batch(
    ["eval", "window.__dragReleased = false; document.addEventListener('mouseup', () => { window.__dragReleased = true; }, {once:true, capture:true})"],
    ["keydown", "Alt"]
  );
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
    const socket = new WebSocket('ws://127.0.0.1:' + process.argv[1]);
    socket.onerror = () => process.exit(1);
    socket.onopen = () => {
      const [from, to] = JSON.parse(process.argv[2]);
      const send = data => socket.send(JSON.stringify(data));
      send({type:'input_mouse', eventType:'mousePressed', ...from, button:'left', clickCount:1, modifiers:1});
      for (let step = 1; step <= 5; step++) send({type:'input_mouse', eventType:'mouseMoved', x:from.x+(to.x-from.x)*step/5, y:from.y+(to.y-from.y)*step/5, button:'left', modifiers:1});
      send({type:'input_mouse', eventType:'mouseReleased', ...to, button:'left', modifiers:1});
      socket.close();
    };
  `, String(status.data.port), JSON.stringify([from, to])], { timeout: 10_000 });
  await batch(
    ["wait", "--fn", "window.__dragReleased"],
    ["keyup", "Alt"]
  );
};

const reportingSelection = async (where: "agent" | "user" | "bubble", mode: number, before?: () => Promise<void>, mounted?: string) => {
  const selector = mounted ?? await placement(where, true, "");
  expect(await read<string>("navigator.platform")).toBe("MacIntel");
  await batch(
    ["eval", `(() => {
    window.__parsed = false;
    window.__input = [];
    window.__probeCalls = window.__fake.app.calls.length;
    if (window.__reportingEmulator !== window.__emu) {
      window.__emu.onInput(bytes => window.__input.push(...bytes));
      window.__reportingEmulator = window.__emu;
    }
    window.__emu.write(new TextEncoder().encode(${JSON.stringify("\x1b[2J\x1b[Hcafé alpha bravo charlie\r\n日本語 delta echo foxtrot")} + '\x1b[?${mode}h\x1b[?1006h'), () => { window.__parsed = true; });
  })()`],
    ["wait", "--fn", "window.__parsed"]
  );

  const cells = await read<{ x: number; y: number; width: number; height: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const size = window.__emu.fit();
    return { x: box.left, y: box.top, width: box.width / size.cols, height: box.height / size.rows };
  })()`);

  const from = { x: Math.round(cells.x + cells.width * 0.2), y: Math.round(cells.y + cells.height * 0.5) };
  await batch(
    ["mouse", "move", String(from.x), String(from.y)],
    ["mouse", "down"],
    ["mouse", "up"],
    ["wait", "--fn", "window.__input.length > 0"],
    ["wait", "--fn", "window.__fake.app.calls.slice(window.__probeCalls).filter(c => c.method === 'terminal.write').reduce((n,c) => n + atob(c.params.data).length, 0) === window.__input.length"]
  );
  await before?.();
  await browser("eval", "window.__input = []; window.__calls = window.__fake.app.calls.length; window.__mouseModifiers = []; document.addEventListener('mousedown', e => window.__mouseModifiers.push([e.altKey, e.shiftKey]), { once: true, capture: true })");
  await optionDrag(from, { x: Math.round(cells.x + cells.width * 12.2), y: Math.round(cells.y + cells.height * 1.5) });

  return { from, cells };
};

it.each(["agent", "user", "bubble"] as const)("u5549a_option_drag_selects_without_mouse_bytes_%s", async where => {
  const selector = await placement(where, true, "");

  for (const mode of [1000, 1002]) {
    await reportingSelection(where, mode, undefined, selector);

    const [modifiers, selection, browserCollapsed, input, calls] = await read<unknown[]>(`[
      window.__mouseModifiers,
      window.__emu.selection(),
      getSelection().isCollapsed,
      window.__input,
      window.__fake.app.calls.slice(window.__calls).filter(c => c.method === 'terminal.write')
    ]`);

    expect(modifiers).toEqual([[true, false]]);
    expect(selection).toBe("café alpha bravo charlie\n日本語 delta");
    expect(browserCollapsed).toBe(true);
    expect(input).toEqual([]);
    expect(calls).toEqual([]);
  }
}, 120_000);

it.each(["agent", "user", "bubble"] as const)("u5549b_reporting_selection_keeps_readonly_menu_%s", async where => {
  const selector = await placement(where, true, "");

  for (const mode of [1000, 1002]) {
    const { from, cells } = await reportingSelection(where, mode, undefined, selector);
    const selected = await read<string>("window.__emu.selection()");
    expect(selected).toBe("café alpha bravo charlie\n日本語 delta");
    await browser("eval", `(() => {
      window.__calls = window.__fake.app.calls.length;
      window.__clipboard = window.__fake.app.clipboardWrites.length;
      window.__input = [];
      window.__controls = [...document.querySelectorAll('[role=menu], [role=dialog], .app-popover')];
      document.addEventListener('mousedown', () => { queueMicrotask(() => { window.__pressSelection = window.__emu.selection(); }); }, { once: true, capture: true });
      document.elementFromPoint(${from.x}, ${from.y}).closest('.xterm').addEventListener('contextmenu', () => { window.__contextSelection = { terminal: window.__emu.selection(), browser: getSelection().toString() }; }, { once: true, capture: true });
    })()`);
    await rightAt({ x: Math.round(from.x + cells.width * 7), y: from.y });

    const [context, pressSelection, contextSelection, selectionBeforeRelease, selection, input, calls, clipboardWrites, controls] = await read<unknown[]>(`[
      window.__context,
      window.__pressSelection,
      window.__contextSelection,
      window.__selectionBeforeRelease,
      ({ terminal: window.__emu.selection(), browser: getSelection().toString() }),
      window.__input,
      window.__fake.app.calls.slice(window.__calls).filter(c => ['terminal.write', 'message.send', 'agent.spawn', 'terminal.open'].includes(c.method)),
      window.__fake.app.clipboardWrites.length - window.__clipboard,
      [...document.querySelectorAll('[role=menu], [role=dialog], .app-popover')].filter(node => !window.__controls.includes(node)).length
    ]`);

    expect(context).toEqual({ editable: false, cancelled: false, selected });
    expect(pressSelection).toBe(selected);
    expect(contextSelection).toEqual({ terminal: selected, browser: selected });
    expect(selectionBeforeRelease).toBe(selected);
    expect(selection).toEqual({ terminal: selected, browser: selected });
    expect(input).toEqual([]);
    expect(calls).toEqual([]);
    expect(clipboardWrites).toBe(0);
    expect(controls).toBe(0);
  }
}, 120_000);

const optionText = async () => {
  await batch(
    ["eval", "window.__input = []; window.__typingCalls = window.__fake?.app.calls.length ?? 0"],
    ["press", "Alt+e"],
    ["keyboard", "inserttext", "é"],
    ["wait", "--fn", "new TextDecoder().decode(new Uint8Array(window.__input)).includes('é')"]
  );
  const [bytes, appMounted] = await read<[number[], boolean]>("[window.__input, !!window.__fake]");

  if (appMounted) {
    await wait(`window.__fake.app.calls.slice(window.__typingCalls).filter(c => c.method === 'terminal.write').reduce((n,c) => n + atob(c.params.data).length, 0) === ${bytes.length}`);
    expect(await read("window.__fake.app.calls.slice(window.__typingCalls).filter(c => c.method === 'terminal.write').flatMap(c => [...atob(c.params.data)].map(ch => ch.charCodeAt(0)))")).toEqual(bytes);
  }

  return bytes;
};

it.each(["agent", "user", "bubble"] as const)("u5549c_option_typing_survives_selection_%s", async where => {
  let before: number[] = [];
  const { from, cells } = await reportingSelection(where, 1002, async () => { before = await optionText(); });
  await rightAt({ x: Math.round(from.x + cells.width * 7), y: from.y });
  await batch(
    ["press", "Escape"],
    ["mouse", "move", String(from.x), String(from.y)],
    ["mouse", "down"],
    ["mouse", "up"]
  );
  expect(await read("window.__emu.selection()")).toBe("");
  const after = await optionText();
  await load("?plain&mac");
  await batch(
    ["click", ".xterm-screen"],
    ["eval", "window.__input = []; window.__emu.onInput(bytes => window.__input.push(...bytes))"]
  );
  const plain = await optionText();
  // Chromium sends the physical Alt+e as e; the committed character probes text input separately.
  expect(plain).toEqual([...new TextEncoder().encode("eé")]);
  expect(before).toEqual(plain);
  expect(after).toEqual(plain);
}, 120_000);

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
  await browser("click", ".window-title");
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
        window.__fake.failNext(-32003, 'Name changed. Retry.');
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
