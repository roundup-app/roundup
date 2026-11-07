import { makeEventListener } from "@solid-primitives/event-listener";
import { createRoot } from "solid-js";
import type { ILink, Terminal } from "@xterm/xterm";
import { createLinkProvider } from "./linkProvider";
import type { Printed } from "./links";

/** Leave enough time to cancel the first click when the user selects a word. */
export const LINK_CLICK_MS = 500;

/** U365: own link gestures before mouse reports, retaining xterm's native selection elsewhere. */
export const attachLinkGestures = (terminal: Terminal, host: HTMLElement, open: (printed: Printed) => void) => {
  const provider = createLinkProvider(terminal, open);
  let pointer: { clientX: number; clientY: number } | null = null;
  let pressed: { x: number; y: number; cell: number; row: number; link: ILink; reporting: boolean; dragged: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | null = null;
  let marks: HTMLElement[] = [];
  let shown = "";

  const cellAt = (event: { clientX: number; clientY: number }) => {
    const screen = host.querySelector(".xterm-screen");

    if (!screen) return null;
    const box = screen.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) * terminal.cols / box.width);
    const row = Math.floor((event.clientY - box.top) * terminal.rows / box.height);

    if (x < 0 || x >= terminal.cols || row < 0 || row >= terminal.rows) return null;

    return { x, row: row + terminal.buffer.active.viewportY };
  };

  const linkAt = (cell: { x: number; row: number } | null): ILink | undefined => {
    if (!cell) return undefined;
    let found: ILink | undefined;
    provider.provideLinks(cell.row + 1, links => {
      found = links?.find(link => {
        const { start, end } = link.range;

        return (cell.row + 1 > start.y || cell.x + 1 >= start.x) && (cell.row + 1 < end.y || cell.x + 1 <= end.x);
      });
    });

    return found;
  };

  const refresh = () => {
    // U6283a: with no pointer over the Terminal and nothing shown, a frame has nothing to detect or draw.
    if (!pointer && shown === "") return;

    const link = linkAt(pointer && cellAt(pointer));
    const { start, end } = link?.range ?? { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
    const key = link ? [start.x, start.y, end.x, end.y, link.text, terminal.buffer.active.type, terminal.buffer.active.viewportY, terminal.cols, terminal.rows].join("|") : "";

    if (shown === key) return;
    shown = key;

    for (const mark of marks) mark.remove();
    marks = [];
    (terminal.element ?? host).style.cursor = link ? "pointer" : "";

    if (!link) return;
    const screen = host.querySelector(".xterm-screen");

    if (!screen) return;
    const buffer = terminal.buffer.active;

    // xterm's buffer decorations are hidden in the alternate buffer; screen-relative ink serves both buffers.
    for (let y = link.range.start.y; y <= link.range.end.y; y++) {
      const row = y - 1 - buffer.viewportY;

      if (row < 0 || row >= terminal.rows) continue;
      const x = y === link.range.start.y ? link.range.start.x - 1 : 0;
      const end = y === link.range.end.y ? link.range.end.x : terminal.cols;
      const mark = host.ownerDocument.createElement("div");
      mark.className = "target-underline";
      mark.setAttribute("aria-hidden", "true");
      mark.style.left = `${100 * x / terminal.cols}%`;
      mark.style.top = `${100 * row / terminal.rows}%`;
      mark.style.width = `${100 * (end - x) / terminal.cols}%`;
      mark.style.height = `${100 / terminal.rows}%`;
      screen.append(mark);
      marks.push(mark);
    }
  };

  const cancel = () => { clearTimeout(timer); timer = undefined; pending = null; };

  const finish = () => {
    const activate = pending;
    cancel();
    activate?.();
  };

  const nextPress = (event: MouseEvent) => {
    if (event.detail > 1) cancel();
    else finish();
  };

  const down = (event: MouseEvent) => {
    cancel();
    const cell = cellAt(event);
    const link = linkAt(cell);

    if (event.button !== 0 || event.ctrlKey || event.altKey || !cell || !link) return;
    const reporting = terminal.modes.mouseTrackingMode !== "none";
    pressed = { x: event.clientX, y: event.clientY, cell: cell.x, row: cell.row, link, reporting, dragged: false };

    if (reporting) {
      event.stopPropagation();
      event.preventDefault();
      terminal.focus();

      if (event.detail > 1) {
        const line = terminal.buffer.active.getLine(cell.row)?.translateToString() ?? "";
        const word = [...line.matchAll(/\S+/g)].find(match => match.index <= cell.x && match.index + match[0].length > cell.x);

        if (word) terminal.select(word.index, cell.row, word[0].length);
      }
    }
  };

  const move = (event: MouseEvent) => {
    pointer = { clientX: event.clientX, clientY: event.clientY };

    if (pressed && event.buttons) {
      pressed.dragged ||= Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 3;
      const cell = cellAt(event);

      if (pressed.reporting && cell && pressed.dragged) {
        event.stopPropagation();
        const first = pressed.row * terminal.cols + pressed.cell;
        const last = cell.row * terminal.cols + cell.x;
        const start = Math.min(first, last);
        terminal.select(start % terminal.cols, Math.floor(start / terminal.cols), Math.abs(last - first) + 1);
      }
    }

    refresh();
  };

  const up = (event: MouseEvent) => {
    const gesture = pressed;
    pressed = null;

    if (!gesture) return;

    if (gesture.reporting) event.stopPropagation();

    if (event.detail !== 1 || gesture.dragged || terminal.hasSelection()) return;
    const link = linkAt(cellAt(event));

    if (!link || link.text !== gesture.link.text) return;
    pending = () => link.activate(event, link.text);
    timer = setTimeout(finish, LINK_CLICK_MS);
  };

  const leave = () => { pointer = null; refresh(); };

  // AL3: an OSC 8 link shows its own text; xterm's linkHandler gives the address, activated by the same single-click rules.
  terminal.options.linkHandler = {
    allowNonHttpProtocols: true,
    activate: (event, uri) => {
      if (event.button !== 0 || event.detail !== 1 || event.ctrlKey || event.altKey || terminal.hasSelection()) return;
      pending = () => open({ kind: "url", url: uri });
      timer = setTimeout(finish, LINK_CLICK_MS);
    },
  };

  // One root owns this attach's listeners.
  const stopListeners = createRoot(dispose => {
    makeEventListener(host, "mousedown", down, true);
    makeEventListener(host, "mousemove", move, true);
    makeEventListener(host, "mouseleave", leave);
    const document = host.ownerDocument;
    makeEventListener(document, "mouseup", up, true);
    makeEventListener(document, "mousedown", nextPress, true);

    return dispose;
  });

  // U6283a: a scroll always ends in a render, so one pass per frame after xterm draws covers both.
  const rendered = terminal.onRender(refresh);

  return () => {
    cancel();
    terminal.options.linkHandler = null;
    rendered.dispose();

    for (const mark of marks) mark.remove();
    (terminal.element ?? host).style.cursor = "";
    stopListeners();
  };
};
