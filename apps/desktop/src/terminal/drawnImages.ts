import type { IBuffer, IMarker, Terminal } from "@xterm/xterm";

/** U5984: what a reopened Terminal needs to draw its images again. The serialized screen holds text only, so each drawn image's Kitty command rides inside it. */
const RETAINED_BASE64_LIMIT = 4 * 1024 * 1024;

type Drawn = { marker: IMarker; col: number; replay: string };

type Transfer = { control: string; payload: string };

const keysOf = (control: string): Map<string, string> => {
  const keys = new Map<string, string>();

  for (const pair of control.split(",")) {
    const equals = pair.indexOf("=");

    if (equals > 0) keys.set(pair.slice(0, equals), pair.slice(equals + 1));
  }

  return keys;
};

/** The command that draws a whole transfer in one piece, at the cursor, without moving it. */
const replayOf = (transfer: Transfer): string => {
  const keys = keysOf(transfer.control);

  for (const key of ["m", "i", "I", "p", "q", "C"]) keys.delete(key);

  return `\x1b_G${[...[...keys].map(([key, value]) => `${key}=${value}`), "q=2", "C=1"].join(",")};${transfer.payload}\x1b\\`;
};

/**
 * Records each Kitty image the Terminal draws (`a=T`, chunked or whole) behind its line, and splices the
 * images back into a serialized screen. Passes every sequence on to the image addon untouched.
 */
export const recordDrawnImages = (terminal: Terminal, scrollback: number) => {
  const drawn: Drawn[] = [];
  let pending: Transfer | null = null;

  const finish = (transfer: Transfer) => {
    const buffer = terminal.buffer.active;
    const marker = terminal.registerMarker(0);

    if (buffer.type !== "normal" || !marker) return;

    drawn.push({ marker, col: buffer.cursorX, replay: replayOf(transfer) });

    let held = 0;

    for (let index = drawn.length - 1; index >= 0; index--) {
      held += drawn[index]!.replay.length;

      if (held > RETAINED_BASE64_LIMIT || drawn[index]!.marker.isDisposed) drawn.splice(index, 1);
    }
  };

  terminal.parser.registerApcHandler({ final: "G" }, (data) => {
    const split = data.indexOf(";");
    const control = split < 0 ? data : data.slice(0, split);
    const payload = split < 0 ? "" : data.slice(split + 1);
    const keys = keysOf(control);
    const continuation = [...keys.keys()].every(key => key === "m" || key === "q");
    const action = keys.get("a") ?? "t";

    if (pending && continuation) pending.payload += payload;
    else if (action === "T") pending = { control, payload };
    else if (!continuation && action !== "q" && action !== "p") pending = null;

    if (pending && keys.get("m") !== "1") {
      finish(pending);
      pending = null;
    }

    return false;
  });

  /** `data` from SerializeAddon with the images placed at their lines; unchanged when the lines cannot be matched. */
  const serialized = (data: string): string => {
    const live = drawn.filter(image => !image.marker.isDisposed);

    if (live.length === 0) return data;

    const buffer: IBuffer = terminal.buffer.active;
    const pieces = data.split("\r\n");
    const pieceOf = new Map<number, number>();
    let piece = -1;

    for (let line = Math.max(0, buffer.length - terminal.rows - scrollback); line < buffer.length; line++) {
      if (!buffer.getLine(line)?.isWrapped || piece < 0) piece++;

      pieceOf.set(line, piece);
    }

    if (piece + 1 < pieces.length) return data;

    for (const image of live) {
      const index = pieceOf.get(image.marker.line);

      if (index === undefined || index >= pieces.length || buffer.getLine(image.marker.line)?.isWrapped) continue;

      pieces[index] = `\x1b[${image.col + 1}G${image.replay}\x1b[1G${pieces[index]}`;
    }

    return pieces.join("\r\n");
  };

  return { serialized };
};
