import { expect, it } from "vitest";
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
  const socket = new WebSocket(`ws://127.0.0.1:${status.data.port}`);

  await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error("agent-browser input stream failed")), { once: true }); });
  await browser("eval", "window.__doubleClicked = false; document.addEventListener('dblclick', () => { window.__doubleClicked = true; }, { once: true, capture: true })");

  for (const clickCount of [1, 2]) for (const eventType of ["mousePressed", "mouseReleased"]) socket.send(JSON.stringify({ type: "input_mouse", eventType, ...at, button: "left", clickCount }));

  try { await wait("window.__doubleClicked === true"); } finally { socket.close(); }
};

it("u2680c_chrome_drag_and_double_click_leave_no_browser_selection", async () => {
  await app();

  for (const selector of [".window-title", ".shelf-tabs", ".shelf-add", ".shelf-title", ".terminal-new", ".hint-line", ".pane-empty"]) {
    await drag(await point(selector), await point(selector, true));
    expect(await read<boolean>("getSelection().isCollapsed"), selector).toBe(true);
    await browser("dblclick", selector);
    expect(await read<boolean>("getSelection().isCollapsed"), selector).toBe(true);
  }
}, 180_000);

it("u2680d_leaving_an_editor_clears_selection_without_changing_text", async () => {
  await app();
  await browser("eval", `(() => {
    const input = document.createElement('input');
    input.id = 'selection-input';
    input.value = 'alpha bravo';
    input.style.position = 'fixed'; input.style.top = '100px'; input.style.left = '500px';
    document.body.append(input); input.focus(); input.select();
  })()`);
  expect(await read<number>("document.querySelector('#selection-input').selectionEnd - document.querySelector('#selection-input').selectionStart")).toBe(11);
  await browser("click", ".window-title");
  expect(await read<{ text: string; selected: number }>("(() => { const input = document.querySelector('#selection-input'); return { text: input.value, selected: input.selectionEnd - input.selectionStart }; })()")).toEqual({ text: "alpha bravo", selected: 0 });
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

it.each(["agent", "door", "bubble"] as const)("u2680b_a_click_clears_browser_and_terminal_selections_%s", async (where) => {
  const selector = await placement(where);
  const targets = [selector, ".rail", ".shelf-tabs", ".window-title", ".hint-line"];

  if (where === "bubble") targets.push(".bubble-header", ...["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(zone => `.bubble-zone[data-zone="${zone}"]`));

  targets.push(".terminal-new");

  for (const target of targets) {
    await browser("dblclick", selector);
    expect(await read<string>("window.__emu.selection()"), target).not.toBe("");
    await browser("eval", "(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.window-title')); getSelection().addRange(range); })()");
    const at = await point(target);

    await browser("mouse", "move", String(at.x), String(at.y));
    await browser("mouse", "down");
    await browser("mouse", "up");
    expect(await read<{ terminal: string; browser: boolean }>("({ terminal: window.__emu.selection(), browser: getSelection().isCollapsed })"), target).toEqual({ terminal: "", browser: true });

    if (where === "bubble" && await read<boolean>("!document.querySelector('.bubble:not([hidden])')")) {
      await browser("click", ".terminal-tab");
      expect(await read<string>("window.__emu.selection()")).toBe("");
    }
  }
}, 180_000);

it.each(["pad", "todo", "rename"] as const)("u2680d_editors_keep_native_selection_and_copy_%s", async (kind) => {
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
  } else {
    await browser("dblclick", '[data-id="migrate"] .name');
    selector = '[data-id="migrate"] input';
  }

  const before = await read<string>(`(() => { const editor = document.querySelector(${JSON.stringify(selector)}); return editor.value ?? editor.textContent; })()`);

  for (const gesture of ["drag", "double-click"]) {
    if (!await read<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`)) {
      await browser("dblclick", kind === "todo" ? ".todo-detail-title p" : '[data-id="migrate"] .name');
    }

    if (gesture === "drag") {
      const from = await read<{ x: number; y: number }>(`(() => {
        const editor = document.querySelector(${JSON.stringify(selector)});
        const box = (editor.querySelector('p') ?? editor).getBoundingClientRect();
        return { x: Math.round(box.left + 3), y: Math.round(box.top + 8) };
      })()`);

      await drag(from, { x: from.x + 55, y: from.y });
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
  }

  await browser("click", ".window-title");
  expect(await read<{ selected: string; text: string }>("({ selected: !window.__editor.isConnected ? '' : window.__editor instanceof HTMLTextAreaElement || window.__editor instanceof HTMLInputElement ? window.__editor.value.slice(window.__editor.selectionStart, window.__editor.selectionEnd) : getSelection().toString(), text: window.__editor.value ?? window.__editor.textContent })")).toEqual({ selected: "", text: before });
}, 120_000);

it.runIf(process.env["U2680_REAL"] === "1")("u2680a_u2680b_real_zsh_webgl_selection_observer", async () => {
  const { startRealDaemon } = await import("../testing/realDaemonFixture");
  const real = await startRealDaemon({ SHELL: "/bin/zsh" }, true);

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await wait("!!document.querySelector('.terminal-new')");
    await browser("click", ".terminal-new");
    await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen canvas')");
    await browser("eval", "window.__emu = [...window.__terminals.values()][0]");
    await browser("focus", ".bubble:not([hidden]) .xterm-helper-textarea");
    await browser("keyboard", "type", "printf 'alpha bravo charlie delta echo foxtrot %.0s' {1..1000}");
    await browser("press", "Enter");
    await wait(`(async () => {
      const id = document.querySelector('.bubble:not([hidden])').dataset.bubble;
      const response = await fetch('/__daemon/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'terminal.snapshot', params: { id } }) });
      const reply = await response.json();
      return reply.result && atob(reply.result.data).split('alpha bravo charlie delta echo foxtrot').length > 10;
    })()`);
    const screen = ".bubble:not([hidden]) .xterm-screen";
    const at = await point(screen);
    const from = { x: at.x + 20, y: await read<number>("Math.round(document.querySelector('.bubble:not([hidden]) .xterm-screen').getBoundingClientRect().top + 8)") };

    await drag(from, { x: from.x + 100, y: from.y });
    expect(await read<string>("window.__emu.selection()")).not.toBe("");
    expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
    await browser("click", ".bubble-header");
    expect(await read<string>("window.__emu.selection()")).toBe("");
    await doubleAt({ x: from.x + 20, y: from.y });
    expect(await read<string>("window.__emu.selection()")).not.toBe("");
    await browser("click", ".window-title");
    expect(await read<string>("window.__emu.selection()")).toBe("");
  } finally {
    await browser("open", url("/src/terminal/u514.html"));
    await real.stop();
  }
}, 180_000);
