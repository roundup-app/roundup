import { copy } from "../copy";
import type { IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";

/** U514: one command of a shell Terminal, as buffer rows from its prompt to its last line of output. */
export type TurnRows = { first: number; last: number; exit: number | null; cwd: string | null };

type Turn = {
  start: IMarker;
  /** The row after the output, or null while the command still runs. */
  end: IMarker | null;
  endColumn: number;
  exit: number | null;
  cwd: string | null;
  gutter: IDecoration | null;
  gutterRows: number;
};

/** The directory an `OSC 7` names (`file://host/path`), or null when it is not one. */
const directoryOf = (data: string): string | null => {
  try {
    const url = new URL(data);

    return url.protocol === "file:" ? decodeURIComponent(url.pathname) : null;
  } catch {
    return null;
  }
};

/**
 * X15's shell marks as Turns. The Turns are xterm markers, so scrollback, resize and reflow move them,
 * and a Turn whose prompt scrolls out of the buffer is dropped with it. A Terminal that prints no mark has none.
 */
export const attachTurns = (terminal: Terminal, select: (first: number, last: number) => void) => {
  const turns: Turn[] = [];
  let cwd: string | null = null;
  let anchor: Turn | null = null;
  const listeners: IDisposable[] = [];

  const lastRow = (turn: Turn): number => {
    const first = turn.start.line;

    if (turn.end === null) {
      const buffer = terminal.buffer.active;
      const cursor = buffer.baseY + buffer.cursorY;

      return Math.max(first, buffer.cursorX === 0 ? cursor - 1 : cursor);
    }

    return Math.max(first, turn.endColumn === 0 ? turn.end.line - 1 : turn.end.line);
  };

  const rows = (turn: Turn): TurnRows => ({ first: turn.start.line, last: lastRow(turn), exit: turn.exit, cwd: turn.cwd });

  const drop = (turn: Turn) => {
    const index = turns.indexOf(turn);

    if (index >= 0) turns.splice(index, 1);

    if (anchor === turn) anchor = null;

    turn.gutter?.dispose();
    turn.end?.dispose();
  };

  /** The gutter: a strip over the Turn's rows, drawn over the cell grid so `cols` stays what it is without it. */
  const drawGutter = (turn: Turn) => {
    const height = lastRow(turn) - turn.start.line + 1;

    if (turn.gutter !== null && turn.gutterRows === height) return;

    turn.gutter?.dispose();
    turn.gutterRows = height;
    turn.gutter = terminal.registerDecoration({ marker: turn.start, x: 0, width: 1, height, layer: "bottom" }) ?? null;
    turn.gutter?.onRender((band) => {
      band.classList.add("turn-band");

      if (band.firstElementChild) return;

      const strip = document.createElement("button");

      strip.type = "button";
      strip.className = "turn-gutter";
      strip.setAttribute("aria-label", copy.selectCommand);
      strip.tabIndex = -1;
      // The click must not move the keyboard out of the Terminal.
      strip.addEventListener("mousedown", (press) => press.preventDefault());
      strip.addEventListener("click", (click) => choose(turn, click.shiftKey));
      band.append(strip);
    });
  };

  const choose = (turn: Turn, extend: boolean) => {
    const base = extend && anchor !== null && turns.includes(anchor) ? anchor : turn;
    const [from, to] = [turns.indexOf(base), turns.indexOf(turn)].sort((x, y) => x - y);

    anchor = base;
    select(turns[from!]!.start.line, lastRow(turns[to!]!));
  };

  const open = (): Turn | null => {
    const turn = turns[turns.length - 1];

    return turn !== undefined && turn.end === null ? turn : null;
  };

  const mark = (data: string): boolean => {
    const [kind, value] = data.split(";");
    const line = terminal.registerMarker(0);

    if (!line) return true;

    if (kind === "A") {
      const previous = open();

      // A prompt printed while a command is "running" ends it without an exit code.
      if (previous) {
        previous.end = line;
        previous.endColumn = terminal.buffer.active.cursorX;
      }

      const turn: Turn = { start: line, end: null, endColumn: 0, exit: null, cwd: null, gutter: null, gutterRows: 0 };

      line.onDispose(() => drop(turn));
      turns.push(turn);
      drawGutter(turn);
    } else if (kind === "C") {
      const turn = open();

      if (turn) turn.cwd = cwd;

      line.dispose();
    } else if (kind === "D") {
      const turn = open();

      if (turn) {
        turn.end = line;
        turn.endColumn = terminal.buffer.active.cursorX;
        turn.exit = value === undefined || value === "" ? null : Number(value);
        drawGutter(turn);
      } else line.dispose();
    } else line.dispose();

    return true;
  };

  listeners.push(
    terminal.parser.registerOscHandler(133, mark),
    terminal.parser.registerOscHandler(7, (data) => {
      cwd = directoryOf(data) ?? cwd;

      return true;
    }),
    // A running Turn grows with its output.
    terminal.onWriteParsed(() => {
      const turn = open();

      if (turn) drawGutter(turn);
    }),
  );

  return {
    turns: (): TurnRows[] => turns.map(rows),
    /** Selects Turn `index`; with `extend`, from the Turn last selected on its own through it, in order. */
    selectTurn: (index: number, extend: boolean) => {
      const turn = turns[index];

      if (turn) choose(turn, extend);
    },
    dispose: () => {
      listeners.forEach((listener) => listener.dispose());
      [...turns].forEach(drop);
    },
  };
};
