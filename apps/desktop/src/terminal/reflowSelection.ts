import type { Terminal } from "@xterm/xterm";

const rowWidth = (terminal: Terminal, row: number, cols: number): number => {
  const buffer = terminal.buffer.active;
  const last = buffer.getLine(row)?.getCell(cols - 1);
  const next = buffer.getLine(row + 1);

  // xterm pads the last cell when a wide glyph wraps; that padding is not a selected character.
  return next?.isWrapped && next.getCell(0)?.getWidth() === 2 && last?.getCode() === 0 ? cols - 1 : cols;
};

/**
 * xterm clears selection on resize. Its markers follow reflow, so retain endpoints in their
 * logical lines rather than anchoring them to physical rows that a new column count replaces.
 * Call before the resize with the column count it replaces; the returned function reselects after it and frees the markers.
 */
export const keepSelection = (terminal: Terminal, previousCols: number): (() => void) => {
  const endpoint = (x: number, y: number) => {
    const buffer = terminal.buffer.active;
    let first = y;

    while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1;

    const marker = terminal.registerMarker(first - buffer.baseY - buffer.cursorY);

    let offset = x;

    for (let row = first; row < y; row += 1) offset += rowWidth(terminal, row, previousCols);

    return { marker, offset };
  };

  const selection = terminal.getSelectionPosition();
  const start = selection ? endpoint(selection.start.x, selection.start.y) : null;
  const end = selection ? endpoint(selection.end.x, selection.end.y) : null;

  return () => {
    if (start?.marker && end?.marker && !start.marker.isDisposed && !end.marker.isDisposed) {
      const position = (line: number, offset: number) => {
        while (terminal.buffer.active.getLine(line + 1)?.isWrapped && offset >= rowWidth(terminal, line, terminal.cols)) {
          offset -= rowWidth(terminal, line, terminal.cols);
          line += 1;
        }

        return { line, col: offset };
      };

      const from = position(start.marker.line, start.offset);
      const to = position(end.marker.line, end.offset);

      terminal.select(from.col, from.line, (to.line - from.line) * terminal.cols + to.col - from.col);
    }

    start?.marker?.dispose();
    end?.marker?.dispose();
  };
};
