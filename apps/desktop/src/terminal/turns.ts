import { copy } from "./copy";
import type { IDisposable, IMarker, Terminal } from "@xterm/xterm";

/** U514: one command of a shell Terminal, as buffer rows from its prompt to its last line of output. */
export type TurnRows = { first: number; last: number; exit: number | null; cwd: string | null; command: string | null };

type Turn = {
  start: IMarker;
  /** The row after the output, or null while the command still runs. */
  end: IMarker | null;
  endColumn: number;
  exit: number | null;
  cwd: string | null;
  command: string | null;
  gutter: HTMLButtonElement | null;
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
  /** Where the prompt ended (`B`), until the command starts (`C`). */
  let typing: { at: IMarker; column: number } | null = null;
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

  const rows = (turn: Turn): TurnRows => ({ first: turn.start.line, last: lastRow(turn), exit: turn.exit, cwd: turn.cwd, command: turn.command });

  const drop = (turn: Turn) => {
    const index = turns.indexOf(turn);

    if (index >= 0) turns.splice(index, 1);

    if (anchor === turn) anchor = null;

    turn.gutter?.remove();
    turn.end?.dispose();
  };

  let strips: HTMLElement | null = null;

  /**
   * The gutter: one strip per Turn, on each visible slice of its rows and left of the cell grid, so it covers no glyph,
   * `cols` stays what it is without it, and a Turn taller than the screen keeps a strip on every visible row.
   */
  const drawGutters = () => {
    const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");

    if (!screen || terminal.rows === 0) return;

    if (!strips || strips.parentElement !== screen) {
      strips = document.createElement("div");
      strips.className = "turn-strips";
      strips.setAttribute("data-turn-strips", "");
      screen.append(strips);
    }

    const buffer = terminal.buffer.active;
    const top = buffer.viewportY;
    const bottom = top + terminal.rows - 1;
    const rowHeight = screen.clientHeight / terminal.rows;

    for (const turn of turns) {
      const first = Math.max(turn.start.line, top);
      const last = Math.min(lastRow(turn), bottom);

      if (first > last) {
        turn.gutter?.remove();
        continue;
      }

      let strip = turn.gutter;

      if (!strip) {
        strip = document.createElement("button");
        strip.type = "button";
        strip.className = "turn-gutter";
        strip.tabIndex = -1;
        // The click must not move the keyboard out of the Terminal.
        strip.addEventListener("mousedown", (press) => press.preventDefault());
        strip.addEventListener("click", (click) => choose(turn, click.shiftKey));
        turn.gutter = strip;
      }

      const command = buffer.getLine(turn.start.line)?.translateToString(true).trim();

      strip.setAttribute("aria-label", command ? `${copy.selectCommand}: ${command}` : copy.selectCommand);
      strip.style.top = `${(first - top) * rowHeight}px`;
      strip.style.height = `${(last - first + 1) * rowHeight}px`;

      if (strip.parentElement !== strips) strips.append(strip);
    }
  };

  /** The text from the end of the prompt to the cursor, where the command starts running. */
  const commandText = (row: number, column: number): string | null => {
    const buffer = terminal.buffer.active;
    const last = buffer.baseY + buffer.cursorY;
    const lines: string[] = [];

    for (let at = row; at <= last; at += 1) {
      const text = buffer.getLine(at)?.translateToString(true, at === row ? column : 0, at === last ? buffer.cursorX : undefined) ?? "";

      lines.push(text);
    }

    return lines.join("\n").trim() || null;
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

      const turn: Turn = { start: line, end: null, endColumn: 0, exit: null, cwd: null, command: null, gutter: null };

      line.onDispose(() => drop(turn));
      turns.push(turn);
      drawGutters();
    } else if (kind === "B") {
      typing?.at.dispose();
      typing = { at: line, column: terminal.buffer.active.cursorX };
    } else if (kind === "C") {
      const turn = open();

      if (turn) {
        turn.cwd = cwd;
        turn.command = typing ? commandText(typing.at.line, typing.column) : null;
      }

      typing?.at.dispose();
      typing = null;
      line.dispose();
    } else if (kind === "D") {
      const turn = open();

      if (turn) {
        turn.end = line;
        turn.endColumn = terminal.buffer.active.cursorX;
        turn.exit = value === undefined || value === "" ? null : Number(value);
        drawGutters();
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
    terminal.onWriteParsed(drawGutters),
    terminal.onScroll(drawGutters),
    terminal.onResize(drawGutters),
    terminal.onRender(drawGutters),
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
      strips?.remove();
    },
  };
};
