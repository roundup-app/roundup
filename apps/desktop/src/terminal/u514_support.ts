import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

// Every observer of these selection clauses measures in this viewport.
export const setViewport = async () => { await browser("set", "viewport", "1512", "950"); };

// CI5527e: the rejected head spent 330091 ms driving these same sequential commands.
// The installed CLI batches them without changing the session, inputs or readiness bounds.
export const batch = (...commands: string[][]) => browser("batch", "--bail", ...commands.map(command => command.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ")));

export const load = async (query = "") => {
  await batch(
    ["open", url(`/src/terminal/u514.html${query}`)],
    ["wait", "--fn", "document.body.dataset.ready === '1' && document.querySelectorAll('.turn-gutter').length >= 0"]
  );
};

export const app = async (base = false, mac = false, items = true) => {
  const seed = process.env.ROUNDUP_CAPTURES ? "tree-40" : "selection";

  const views = `tabs=1${process.env.ROUNDUP_CAPTURES ? "&view=workstreams" : ""}${items ? "&items=1" : ""}`;

  await batch(
    ["eval", "localStorage.clear()"],
    ["open", url(mac ? `/src/terminal/u514.html?app&mac&seed=${seed}&renderer=dom&${views}` : `/harness.html?rest=1&seed=${seed}&renderer=dom&${views}`, base)],
    ["wait", "--fn", items ? "!!document.querySelector('.shelf-tabs')" : "!!document.querySelector('.rail-row') && !!document.querySelector('.terminal-new')"]
  );
};

export const selectRow = async (id: string) => {
  await batch(
    ["focus", `.rail-row[data-id="${id}"]`],
    ["wait", "--fn", `document.activeElement?.matches('.rail-row[data-id="${id}"]')`],
    ["press", "Enter"],
    ["wait", "--fn", `document.querySelector('.rail-row[data-id="${id}"]')?.hasAttribute('data-selected')`]
  );
};

export const point = (selector: string, end = false) => read<{ x: number; y: number }>(`(() => {
  const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.round(${end ? 'box.right - 2' : 'box.left + 2'}), y: Math.round(box.top + box.height / 2) };
})()`);

export const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
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
export const doubleAt = async (at: { x: number; y: number }) => {
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

export const placement = async (where: "agent" | "door" | "user" | "bubble", mac = false, text = "alpha bravo charlie ".repeat(256), items = false) => {
  await app(false, mac, items || !!process.env.ROUNDUP_CAPTURES);

  if (where === "bubble" || where === "user") {
    if (where === "bubble") await selectRow("payments");
    await browser("click", ".terminal-new");
  } else await selectRow(where === "agent" ? "migrate" : "payments");

  const selector = where === "bubble" || where === "user" ? ".bubble:not([hidden]) .xterm-screen" : ".pane-screen .xterm-screen";

  await batch(
    ["wait", "--fn", `(() => {
      const screen = document.querySelector(${JSON.stringify(selector)});
      const bubble = screen?.closest('.bubble');
      return !!screen && (!bubble || window.__terminals.has(bubble.dataset.bubble));
    })()`],
    ["eval", String.raw`(() => {
    const id = ${where === 'bubble' || where === 'user' ? "document.querySelector('.bubble:not([hidden])').dataset.bubble" : JSON.stringify(where === 'agent' ? 't-migrate' : 't-payments')};
    window.__emu = window.__terminals.get(id);
    window.__emu.write(new TextEncoder().encode('\x1b[2J\x1b[H' + ${JSON.stringify(text)}), () => { window.__selectionReady = true; });
  })()`],
    ["wait", "--fn", "window.__selectionReady === true"]
  );

  return selector;
};

export const editorKinds = ["pad", "rename"] as const;

export const editor = async (kind: typeof editorKinds[number] | "pad-source" | "diff" | "ask", base = false) => {
  if (kind === "diff") await browser("eval", "localStorage.clear()");
  else await app(base, false, !!process.env.ROUNDUP_CAPTURES || kind === "pad" || kind === "pad-source");

  let selector: string;

  if (kind === "ask") {
    await browser("press", "Meta+/");
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
      ["wait", "--fn", "document.querySelector('.pads-tab [data-shelf-group=unassigned] .shelf-group-control')?.checkVisibility()"],
    ["eval", "document.querySelector('.pads-tab [data-shelf-group=unassigned] .shelf-group-control[aria-expanded=false]')?.click()"],
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

export const rightAt = async (at: { x: number; y: number }) => {
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
export const optionDrag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
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

export const reportingSelection = async (where: "agent" | "user" | "bubble", mode: number, before?: () => Promise<void>, mounted?: string) => {
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
