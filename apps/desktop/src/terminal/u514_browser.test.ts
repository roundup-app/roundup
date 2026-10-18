import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (query = "") => {
  await browser("open", url(`/src/terminal/u514.html${query}`));
  await wait("document.body.dataset.ready === '1' && document.querySelectorAll('.turn-gutter').length >= 0");
};

it("u514_browser_the_gutters_select_turns", async () => {
  await load();
  await wait("document.querySelectorAll('.turn-gutter').length === 3");
  expect(await read<string[]>("[...document.querySelectorAll('.turn-gutter')].map(g => g.getAttribute('aria-label') + ':' + g.tagName)")).toEqual(["Select command: $ one:BUTTON", "Select command: $ two:BUTTON", "Select command: $ three:BUTTON"]);

  await browser("click", ".turn-gutter:first-of-type");
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

const app = async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("eval", "localStorage.clear()");
  await browser("open", url("/harness.html?seed=tree-40&renderer=dom"));
  await wait("!!document.querySelector('.shelf-tabs')");
};

const point = (selector: string, end = false) => read<{ x: number; y: number }>(`(() => {
  const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.round(${end ? 'box.right - 2' : 'box.left + 2'}), y: Math.round(box.top + box.height / 2) };
})()`);

const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
  await browser("mouse", "move", String(from.x), String(from.y));
  await browser("mouse", "down");

  for (let step = 1; step <= 5; step++) await browser("mouse", "move", String(Math.round(from.x + (to.x - from.x) * step / 5)), String(Math.round(from.y + (to.y - from.y) * step / 5)));
  await browser("mouse", "up");
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

const chromeSurfaces = [
  ".window-title", ".project-tab", ".terminal-tab", ".pane-control-state",
  '[data-id="migrate"] .name', ".rail-add", ".todo-project-root",
  ".shelf-tabs", ".shelf-add", ".shelf-title", ".todo-row-button",
  ".terminal-new", ".resource-num", ".hint-line", ".overview-heading",
  ".pane-empty", ".pane-empty-keys",
];

it.each(chromeSurfaces.flatMap(surface => ["drag", "double-click"].map(gesture => ({ surface, gesture }))))(
  "u2680c_chrome_drag_and_double_click_leave_no_browser_selection_$surface ($gesture)", async ({ surface, gesture }) => {
    await app();

    if (surface === ".pane-empty-keys") {
      await browser("open", url("/harness.html?seed=empty-project&renderer=dom"));
    } else if (surface === ".pane-control-state" || surface === ".resource-num") {
      await browser("click", surface === ".pane-control-state" ? '[data-id="agent-4"] .name' : '[data-id="migrate"] .name');
    } else if (surface === ".terminal-tab") {
      await browser("click", ".terminal-new");
      await browser("click", ".window-title");
    }

    await wait(`!!document.querySelector(${JSON.stringify(surface)})`);

    if (gesture === "drag") await drag(await point(surface), await point(surface, true));
    else await browser("dblclick", surface);

    expect(await read<boolean>("getSelection().isCollapsed"), surface).toBe(true);
  }, 90_000);

it.each(["pane-across-shelf", "blank-bubbles-into-pane"])("u2680c_chrome_drag_and_double_click_leave_no_browser_selection_%s", async (surface) => {
  const selector = await placement("bubble");

  const from = surface === "pane-across-shelf" ? await point(".pane") : await read<{ x: number; y: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.ceil(box.right + 20), y: Math.round(box.top + 8) };
  })()`);

  await drag(from, await point(surface === "pane-across-shelf" ? ".shelf" : ".pane"));
  expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
}, 90_000);

const placement = async (where: "agent" | "door" | "bubble") => {
  await app();

  if (where === "bubble") await browser("click", ".terminal-new");
  else await browser("click", `[data-id="${where === "agent" ? "migrate" : "payments"}"] .name`);

  const selector = where === "bubble" ? ".bubble:not([hidden]) .xterm-screen" : ".pane-screen .xterm-screen";

  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  await browser("eval", String.raw`(() => {
    const id = ${where === 'bubble' ? "document.querySelector('.bubble:not([hidden])').dataset.bubble" : JSON.stringify(where === 'agent' ? 't-migrate' : 't-payments')};
    window.__emu = window.__terminals.get(id);
    window.__emu.write(new TextEncoder().encode('\x1b[2J\x1b[H' + 'alpha bravo charlie '.repeat(1000)), () => { window.__selectionReady = true; });
  })()`);
  await wait("window.__selectionReady === true");

  return selector;
};

it.each(["agent", "door", "bubble"] as const)("u2680a_output_drag_and_double_click_use_only_terminal_selection_%s", async (where) => {
  const selector = await placement(where);
  const at = await point(selector);
  const from = { x: at.x + 3, y: await read<number>(`Math.round(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + 8)`) };

  await drag(from, { x: from.x + 110, y: from.y });
  expect(await read<string>("window.__emu.selection()")).not.toBe("");
  expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
  await doubleAt({ x: from.x + 20, y: from.y });
  expect(await read<string>("window.__emu.selection()")).not.toBe("");
  expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
}, 120_000);

it.each(["agent", "door", "bubble"] as const)("u2680a_terminal_boundaries_never_create_browser_selection_%s", async (where) => {
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

const clickTargets = ["output", "inset", "bottom-strip", ".pane", ".rail", ".shelf-tabs", ".shelf-area", ".window-title", ".resource-strip", ".hint-line", ".terminal-new"];

const clickCases = (["agent", "door", "bubble"] as const).flatMap(where => {
  const targets = where === "bubble" ? [...clickTargets, ".bubble-header", ...["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(zone => `.bubble-zone[data-zone="${zone}"]`)] : clickTargets;

  return targets.map(target => ({ where, target }));
});

it.each(clickCases)("u2680b_a_click_clears_browser_and_terminal_selections_$where ($target)", async ({ where, target }) => {
  const selector = await placement(where);
  await browser("dblclick", selector);
  expect(await read<string>("window.__emu.selection()"), target).not.toBe("");
  await browser("eval", "(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.window-title')); getSelection().addRange(range); })()");

  const at = target === "inset" || target === "bottom-strip" ? await read<{ x: number; y: number }>(`(() => {
    const screen = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const host = document.querySelector(${JSON.stringify(selector)}).closest('.pane-screen, .bubble-body').getBoundingClientRect();
    return ${target === "inset" ? "{ x: Math.round(host.left + 1), y: Math.round(host.top + 12) }" : "{ x: Math.round(screen.left + 20), y: Math.floor(host.bottom - 1) }"};
  })()`) : await point(target === "output" ? selector : target);

  await browser("mouse", "move", String(at.x), String(at.y));
  await browser("mouse", "down");
  await browser("mouse", "up");
  expect(await read<{ terminal: string; browser: boolean }>("({ terminal: window.__emu.selection(), browser: getSelection().isCollapsed })"), target).toEqual({ terminal: "", browser: true });

}, 90_000);

const editorKinds = ["pad", "input", "todo", "rename"] as const;

const editor = async (kind: typeof editorKinds[number]) => {
  await app();
  let selector: string;

  if (kind === "pad") {
    await browser("eval", "window.__fake.app.rpc('pad.write', { name: 'pad-3', text: 'alpha bravo charlie delta echo foxtrot' })");
    await browser("click", "#shelf-tab-pads");
    await wait("document.querySelectorAll('[data-shelf-row] .pad-name').length >= 4");
    await browser("eval", "document.querySelectorAll('[data-shelf-row] .pad-name')[3].click()");
    await wait("!!document.querySelector('.ProseMirror[contenteditable=true]')");
    selector = ".ProseMirror";
  } else if (kind === "todo") {
    await browser("click", ".shelf .todo-row-button");
    await wait("!!document.querySelector('.todo-detail-title p')");
    await browser("dblclick", ".todo-detail-title p");
    selector = '.todo-detail-title textarea';
  } else if (kind === "input") {
    await browser("eval", "(() => { const input = document.createElement('input'); input.id = 'selection-input'; input.value = 'alpha bravo charlie'; input.style.position = 'fixed'; input.style.top = '100px'; input.style.left = '500px'; document.body.append(input); })()");
    selector = '#selection-input';
  } else {
    await browser("dblclick", '[data-id="migrate"] .name');
    selector = '[data-id="migrate"] input';
  }

  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);

  return selector;
};

it.each(editorKinds)("u2680d_leaving_an_editor_clears_selection_without_changing_text_%s", async (kind) => {
  const selector = await editor(kind);

  if (kind === "pad") {
    const at = await read<{ x: number; y: number }>("(() => { const box = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: Math.round(box.left + 15), y: Math.round(box.top + 8) }; })()");

    await doubleAt(at);
  } else await browser("dblclick", selector);

  await browser("eval", `void (window.__editor = document.querySelector(${JSON.stringify(selector)}))`);
  const selected = "window.__editor instanceof HTMLInputElement || window.__editor instanceof HTMLTextAreaElement ? window.__editor.value.slice(window.__editor.selectionStart, window.__editor.selectionEnd) : getSelection().toString()";
  const before = await read<string>("window.__editor.value ?? window.__editor.textContent");
  expect(await read<string>(selected)).not.toBe("");
  await browser("click", ".window-title");
  expect(await read<string>(selected)).toBe("");
  expect(await read<string>("window.__editor.value ?? window.__editor.textContent")).toBe(before);
}, 90_000);

it.each(editorKinds.flatMap(kind => ["drag", "double-click"].map(gesture => ({ kind, gesture }))))("u2680d_editors_keep_native_selection_and_copy_$kind ($gesture)", async ({ kind, gesture }) => {
  const selector = await editor(kind);

  if (gesture === "drag") {
    const from = await read<{ x: number; y: number }>(`(() => {
      const editor = document.querySelector(${JSON.stringify(selector)});
      const box = (editor.querySelector('p') ?? editor).getBoundingClientRect();
      return { x: Math.round(${kind === "rename" ? "box.right - 8" : "box.left + 4"}), y: Math.round(box.top + (editor.matches('input, textarea') ? box.height / 2 : 8)) };
    })()`);

    await drag(from, { x: from.x + (kind === "rename" ? -35 : 25), y: from.y });
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
  await browser("eval", "(() => { const input = document.createElement('input'); input.id = 'copy-result'; input.style.position = 'fixed'; input.style.top = '50px'; document.body.append(input); input.focus(); })()");
  await browser("press", "Control+V");
  expect(await read<string>("document.querySelector('#copy-result').value"), `${kind} ${gesture}`).toBe(text);
  await browser("eval", "document.querySelector('#copy-result').remove(); window.__editor.focus()");

}, 120_000);

it("u2680b_minimising_and_restoring_does_not_restore_selection", async () => {
  const selector = await placement("bubble");
  await browser("dblclick", selector);
  expect(await read<string>("window.__emu.selection()")).not.toBe("");
  await browser("click", ".window-title");
  await wait("!document.querySelector('.bubble:not([hidden])')");
  expect(await read<string>("window.__emu.selection()")).toBe("");
  await browser("click", ".terminal-tab");
  await wait("!!document.querySelector('.bubble:not([hidden])')");
  expect(await read<string>("window.__emu.selection()")).toBe("");
}, 90_000);


it.each(["pad", "decision"])("u2680c_readonly_content_keeps_native_selection_and_copy_%s", async (content) => {
  await app();
  let selector: string;

  if (content === "pad") {
    await browser("click", "#shelf-tab-pads");
    await wait("!!document.querySelector('.pad-name')");
    await browser("click", ".pad-name");
    selector = '.pad-readonly .ProseMirror[contenteditable=false] p';
  } else {
    await browser("open", url("/harness.html?seed=decisions&renderer=dom"));
    selector = "pre.decision-args";
  }

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
  await browser("clipboard", "copy");
  await browser("eval", "(() => { const input = document.createElement('input'); input.id = 'copy-result'; input.style.position = 'fixed'; input.style.top = '50px'; document.body.append(input); input.focus(); })()");
  await browser("press", "Control+V");
  expect(await read<string>("document.querySelector('#copy-result').value")).toBe(text);
}, 120_000);
