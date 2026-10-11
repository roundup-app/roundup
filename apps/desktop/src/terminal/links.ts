import type { IBuffer, ILink, ILinkProvider, IBufferLine } from "@xterm/xterm";
import type { OpenTarget } from "../app/seam";

/** One recognised range of a line's text, `end` exclusive. */
export type Found = { start: number; end: number; text: string };

const LEADING = /^[(["'`<]+/;

const TRAILING = /[.,;:)\]"'`>]+$/;

const URL_START = /^https?:\/\/\S/i;

const LINE_SUFFIX = /:(\d+)(?::(\d+))?$/;

const ABSOLUTE = /^\/[\w.@+~%-]+(?:\/[\w.@+~%-]*)*$/;

const RELATIVE_WITH_SLASH = /^[\w.@+~%-]+(?:\/[\w.@+~%-]+)+\/?$/;

const FILE_NAME = /^[\w@+~%-][\w.@+~%-]*\.[A-Za-z]\w{0,7}$/;

const isPath = (text: string): boolean => ABSOLUTE.test(text) || RELATIVE_WITH_SLASH.test(text) || FILE_NAME.test(text);

/** Every web link and file path in `line` (U365): a whitespace-delimited word, minus brackets, quotes and sentence punctuation around it. */
export const findLinks = (line: string): Found[] => {
  const found: Found[] = [];

  for (const word of line.matchAll(/\S+/g)) {
    const lead = LEADING.exec(word[0])?.[0].length ?? 0;
    const stripped = word[0].slice(lead);
    const web = URL_START.test(stripped);
    const body = stripped.replace(TRAILING, "");
    const withoutLine = web ? body : body.replace(LINE_SUFFIX, "");
    const start = (word.index ?? 0) + lead;

    if (web ? body.length > 0 : isPath(withoutLine)) found.push({ start, end: start + body.length, text: body });
  }

  return found;
};

const parts = (path: string): string[] => path.split("/").filter((part) => part !== "" && part !== ".");

const joined = (base: string, relative: string): string => {
  const stack = parts(base);

  for (const part of parts(relative)) {
    if (part === "..") stack.pop();
    else stack.push(part);
  }

  return `/${stack.join("/")}`;
};

/** The target a recognised `text` names; a relative path resolves against `base`, so the App only ever gets absolute paths. */
export const targetOf = (text: string, base: string): OpenTarget => {
  if (URL_START.test(text)) return { kind: "url", url: text };

  const suffix = LINE_SUFFIX.exec(text);
  const path = suffix ? text.slice(0, suffix.index) : text;

  return { kind: "path", path: path.startsWith("/") ? path : joined(base, path), line: suffix ? Number(suffix[1]) : null };
};

type Cell = { x: number; y: number; width: number };

/** The text of the logical line holding row `row`, joined across wrapped rows, with each UTF-16 unit's cell. */
const logicalLine = (buffer: IBuffer, row: number) => {
  let first = row;

  while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1;

  let text = "";
  const cells: Cell[] = [];

  for (let y = first; ; y += 1) {
    const line: IBufferLine | undefined = buffer.getLine(y);

    if (!line || (y > first && !line.isWrapped)) break;

    for (let x = 0; x < line.length; x += 1) {
      const cell = line.getCell(x);

      if (!cell || cell.getWidth() === 0) continue;

      const chars = cell.getChars() || " ";

      for (let unit = 0; unit < chars.length; unit += 1) cells.push({ x, y, width: cell.getWidth() });
      text += chars;
    }
  }

  return { text, cells };
};

/**
 * The xterm link provider every Terminal shares (U365). `activate` only calls `open` with Cmd held; underline and
 * hand pointer follow Cmd: xterm reads `decorations` once on entering a range, so they are getters over the current
 * Cmd; xterm then owns them behind setters, so `sync` writes them on the hovered link whenever Cmd changes.
 */
export const linkProvider = (buffer: () => IBuffer, cmdHeld: () => boolean, open: (text: string) => void): ILinkProvider & { sync: () => void } => {
  let hovered: ILink | undefined;

  const decorate = (link: ILink) => {
    if (!link.decorations) return;

    link.decorations.underline = cmdHeld();
    link.decorations.pointerCursor = cmdHeld();
  };

  return {
    sync: () => { if (hovered) decorate(hovered); },
    provideLinks: (y, callback) => {
      const { text, cells } = logicalLine(buffer(), y - 1);
      const links: ILink[] = [];

      for (const { start, end, text: matched } of findLinks(text)) {
        const from = cells[start];
        const to = cells[end - 1];

        if (!from || !to || y - 1 < from.y || y - 1 > to.y) continue;

        const link: ILink = {
          text: matched,
          range: { start: { x: from.x + 1, y: from.y + 1 }, end: { x: to.x + to.width, y: to.y + 1 } },
          activate: (event) => { if (event.metaKey) open(matched); },
          decorations: { get underline() { return cmdHeld(); }, get pointerCursor() { return cmdHeld(); } },
          hover: () => { hovered = link; },
          leave: () => { if (hovered === link) hovered = undefined; },
        };

        links.push(link);
      }

      callback(links.length > 0 ? links : undefined);
    },
  };
};
