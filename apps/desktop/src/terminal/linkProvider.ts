import type { IBufferLine, IBufferRange, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { findTargets } from "./links";
import type { Printed } from "./links";

type Cell = { y: number; x: number; width: number };

/** One logical line: the rows a long line wrapped over, as text, with the cell each character came from. */
const logicalLine = (terminal: Pick<Terminal, "buffer" | "cols">, y: number): { text: string; cells: Cell[] } | null => {
  const buffer = terminal.buffer.active;
  let first = y;

  while (buffer.getLine(first - 1)?.isWrapped && first > 1) first--;

  let text = "";
  const cells: Cell[] = [];

  for (let row = first; ; row++) {
    const line: IBufferLine | undefined = buffer.getLine(row - 1);

    if (!line || (row > first && !line.isWrapped)) break;

    for (let x = 0; x < terminal.cols; x++) {
      const cell = line.getCell(x);

      if (!cell || cell.getWidth() === 0) continue;

      const chars = cell.getChars() || " ";

      for (let unit = 0; unit < chars.length; unit++) {
        text += chars.charAt(unit);
        cells.push({ y: row, x: x + 1, width: cell.getWidth() });
      }
    }
  }

  return cells.length > 0 ? { text, cells } : null;
};

/** U365: recognised ranges, including wrapped rows, shared by hover and activation. */
export const createLinkProvider = (
  terminal: Pick<Terminal, "buffer" | "cols">,
  open: (printed: Printed) => void,
): ILinkProvider => ({
  provideLinks: (y, callback) => {
    const line = logicalLine(terminal, y);
    const links: ILink[] = [];

    for (const { start, end, printed } of line ? findTargets(line.text) : []) {
      const from = line?.cells[start];
      const to = line?.cells[end - 1];

      if (!line || !from || !to || y < from.y || y > to.y) continue;

      const range: IBufferRange = { start: { x: from.x, y: from.y }, end: { x: to.x + to.width - 1, y: to.y } };

      links.push({
        range,
        text: line.text.slice(start, end),
        decorations: { pointerCursor: true, underline: true },
        activate: (event) => {
          if (event.button === 0) open(printed);
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  },
});
