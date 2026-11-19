import type { Terminal } from "@xterm/xterm";

/**
 * U7640a: xterm's WebGL renderer blends the selection over a cell that has its own background and keeps that background
 * under an inverse cell. A top-layer decoration wins over the selection, so each visible selected run is repainted with
 * the theme's selection colours and every selected cell reads the same in both renderers. Returns the cleanup that stops it.
 */
export const paintSelection = (terminal: Terminal): (() => void) => {
  let painted: { dispose(): void }[] = [];

  const clear = () => {
    for (const decoration of painted) decoration.dispose();

    painted = [];
  };

  const paint = () => {
    clear();

    const selection = terminal.getSelectionPosition();
    const background = terminal.options.theme?.selectionBackground;
    const foreground = terminal.options.theme?.selectionForeground;

    if (!selection || !background || !foreground) return;

    const buffer = terminal.buffer.active;
    const first = Math.max(selection.start.y, buffer.viewportY);
    const last = Math.min(selection.end.y, buffer.viewportY + terminal.rows - 1);

    for (let line = first; line <= last; line += 1) {
      const from = line === selection.start.y ? selection.start.x : 0;
      const to = line === selection.end.y ? selection.end.x : terminal.cols;
      const marker = terminal.registerMarker(line - buffer.baseY - buffer.cursorY);

      if (!marker || to <= from) { marker?.dispose(); continue; }

      const decoration = terminal.registerDecoration({ marker, x: from, width: to - from, layer: "top", backgroundColor: background, foregroundColor: foreground });

      if (decoration) painted.push(decoration);
      // A decoration disposes its marker with it; one that failed to register must not keep the marker.
      else marker.dispose();
    }
  };

  const listeners = [terminal.onSelectionChange(paint), terminal.onScroll(() => { if (terminal.hasSelection()) paint(); })];

  return () => { for (const listener of listeners) listener.dispose(); clear(); };
};
