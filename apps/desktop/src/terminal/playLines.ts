import type { Terminal } from "@xterm/xterm";

/** U7889a: a printed command on screen: the view row it starts on, the rows it wraps over and its text. */
export type PlayLine = { row: number; span: number; command: string };

/** The command a screen line spells, or null when it spells none of `commands`; an indent and a leading `$ ` are not part of it. */
const spelled = (text: string, commands: ReadonlySet<string>): string | null => {
  const line = text.trim();

  for (const candidate of [line, line.replace(/^\$ /, "")]) if (candidate !== "" && commands.has(candidate)) return candidate;

  return null;
};

/**
 * U7889a: the view's lines that equal a printed command, a wrapped long line as one. A line that equals none, however it is
 * coloured, gets nothing: the commands come from the Agent's record, never from how the screen looks.
 */
export const playLines = (terminal: Pick<Terminal, "buffer" | "rows">, printed: readonly string[]): PlayLine[] => {
  if (printed.length === 0) return [];

  const commands = new Set(printed);
  const buffer = terminal.buffer.active;
  const found: PlayLine[] = [];
  let first = buffer.viewportY;

  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;

  const end = buffer.viewportY + terminal.rows;

  while (first < end) {
    let last = first;
    let text = buffer.getLine(first)?.translateToString(true) ?? "";

    for (let next = buffer.getLine(last + 1); next?.isWrapped; next = buffer.getLine(last + 1)) {
      last++;
      text = (buffer.getLine(last - 1)?.translateToString(false) ?? "") + next.translateToString(true);
    }

    const command = spelled(text, commands);
    const top = Math.max(first, buffer.viewportY);

    if (command !== null && last >= buffer.viewportY) found.push({ row: top - buffer.viewportY, span: Math.min(last, end - 1) - top + 1, command });

    first = last + 1;
  }

  return found;
};
