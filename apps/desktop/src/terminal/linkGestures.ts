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
  let marks: { dispose: () => void }[] = [];
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
    const link = linkAt(pointer && cellAt(pointer));
    const key = link ? JSON.stringify([link.range, link.text, terminal.buffer.active.viewportY]) : "";

    if (shown === key) return;
    shown = key;

    for (const mark of marks) mark.dispose();
    marks = [];
    (terminal.element ?? host).style.cursor = link ? "pointer" : "";

    if (!link) return;
    const buffer = terminal.buffer.active;

    for (let y = link.range.start.y; y <= link.range.end.y; y++) {
      const marker = terminal.registerMarker(y - 1 - buffer.baseY - buffer.cursorY);

      if (!marker) continue;
      const x = y === link.range.start.y ? link.range.start.x - 1 : 0;
      const end = y === link.range.end.y ? link.range.end.x : terminal.cols;
      const decoration = terminal.registerDecoration({ marker, x, width: end - x, layer: "top" });
      marks.push(marker);

      if (decoration) {
        marks.push(decoration);
        decoration.onRender(element => { element.classList.add("target-underline"); });
      }
    }
  };

  const cancel = () => { clearTimeout(timer); timer = undefined; };

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
    timer = setTimeout(() => { timer = undefined; link.activate(event, link.text); }, LINK_CLICK_MS);
  };

  const leave = () => { pointer = null; refresh(); };

  host.addEventListener("mousedown", down, true);
  host.addEventListener("mousemove", move, true);
  host.addEventListener("mouseleave", leave);
  const document = host.ownerDocument;
  document.addEventListener("mouseup", up, true);
  document.addEventListener("mousedown", cancel, true);
  const rendered = terminal.onRender(refresh);
  const scrolled = terminal.onScroll(refresh);

  return () => {
    cancel();
    rendered.dispose(); scrolled.dispose();

    for (const mark of marks) mark.dispose();
    (terminal.element ?? host).style.cursor = "";
    host.removeEventListener("mousedown", down, true);
    host.removeEventListener("mousemove", move, true);
    host.removeEventListener("mouseleave", leave);
    document.removeEventListener("mouseup", up, true);
    document.removeEventListener("mousedown", cancel, true);
  };
};
