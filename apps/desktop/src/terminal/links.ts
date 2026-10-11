import type { IBufferLine, IBufferRange, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

/** What a Terminal printed that Cmd+click opens (U365); a path may still be relative. */
export type LinkTarget = { kind: "url"; url: string } | { kind: "path"; path: string; line: number | null };

export type LinkMatch = { start: number; end: number; target: LinkTarget };

const TRAILING = /[.,;:)\]}'"`>]+$/;

const LEADING = /^[(\[{'"`<]+/;

const URL = /^https?:\/\/\S+$/i;

const PATH = /^((?:\/|[^\s:]*\/)[^\s:]*|[^\s:/]+\.[A-Za-z0-9]+)(?::(\d+)(?::\d+)?)?$/;

/** Every web link and path in `text`, by character offset; punctuation around a token is not part of it. */
export const findTargets = (text: string): LinkMatch[] => {
  const matches: LinkMatch[] = [];

  for (const word of text.matchAll(/\S+/g)) {
    const lead = LEADING.exec(word[0])?.[0].length ?? 0;
    const token = word[0].slice(lead).replace(TRAILING, "");
    const start = word.index + lead;
    const end = start + token.length;

    if (URL.test(token)) {
      matches.push({ start, end, target: { kind: "url", url: token } });

      continue;
    }

    const path = PATH.exec(token);

    if (path?.[1]) {
      matches.push({ start, end, target: { kind: "path", path: path[1], line: path[2] === undefined ? null : Number(path[2]) } });
    }
  }

  return matches;
};

/** The rows of the wrapped line holding buffer row `row` (0-based), as one string of full-width rows. */
const wrappedText = (terminal: Pick<Terminal, "buffer" | "cols">, row: number): { first: number; text: string } | null => {
  const buffer = terminal.buffer.active;
  let first = row;

  while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1;

  const rows: IBufferLine[] = [];

  for (let at = first; ; at += 1) {
    const line = buffer.getLine(at);

    if (!line || (at > first && !line.isWrapped)) break;

    rows.push(line);
  }

  if (rows.length === 0) return null;

  return { first, text: rows.map((line, index) => line.translateToString(index === rows.length - 1)).join("") };
};

const rangeOf = (cols: number, first: number, match: LinkMatch): IBufferRange => ({
  start: { x: (match.start % cols) + 1, y: first + Math.floor(match.start / cols) + 1 },
  end: { x: ((match.end - 1) % cols) + 1, y: first + Math.floor((match.end - 1) / cols) + 1 },
});

/**
 * The xterm link provider every Terminal shares (U365). A link wrapped over rows is one target. `cmdHeld` is read when
 * the pointer reaches a link, so the underline and the hand show only while Cmd is down; `open` is called only by a Cmd+click.
 */
export const createLinkProvider = (
  terminal: Pick<Terminal, "buffer" | "cols">,
  open: (target: LinkTarget) => void,
  cmdHeld: () => boolean,
): ILinkProvider => ({
  provideLinks: (y, callback) => {
    const wrapped = wrappedText(terminal, y - 1);

    if (!wrapped) {
      callback(undefined);

      return;
    }

    const links: ILink[] = findTargets(wrapped.text)
      .map((match) => ({ match, range: rangeOf(terminal.cols, wrapped.first, match) }))
      .filter(({ range }) => range.start.y <= y && y <= range.end.y)
      .map(({ match, range }) => ({
        range,
        text: wrapped.text.slice(match.start, match.end),
        decorations: {
          get pointerCursor() {
            return cmdHeld();
          },
          get underline() {
            return cmdHeld();
          },
        },
        activate: (event) => {
          if (event.metaKey) open(match.target);
        },
      }));

    callback(links.length === 0 ? undefined : links);
  },
});
