import type { IBufferCell, IBufferLine, ILink, ILinkProvider } from "@xterm/xterm";

/** What Cmd+click opens (U365): a web link, or a path that is still relative until a Terminal's base folder resolves it. */
export type LinkTarget = { kind: "url"; url: string } | { kind: "path"; path: string; line: number | null; column: number | null };

export type Found = { start: number; end: number; target: LinkTarget };

const TRAILING_URL = /[.,;)'"]+$/;

const SEGMENT = "[\\w.@+-]+";

/** A web link, else a path: `/abs/a.ts`, `src/a.ts`, `a.ts`, each with an optional `:line` or `:line:column`. */
const PATTERN = new RegExp(`https?://\\S+|(?<![\\w@+./-])(/?(?:${SEGMENT}/)*${SEGMENT})(?::(\\d+)(?::(\\d+))?)?`, "g");

const hasFileExtension = (path: string): boolean => /\.[A-Za-z]\w*$/.test(path);

/** Every web link and path in `text`, in order, as the string ranges they occupy. */
export const findTargets = (text: string): Found[] => {
  const found: Found[] = [];

  for (const match of text.matchAll(PATTERN)) {
    const start = match.index;

    if (match[1] === undefined) {
      const url = match[0].replace(TRAILING_URL, "");

      if (/^https?:\/\/./i.test(url)) found.push({ start, end: start + url.length, target: { kind: "url", url } });

      continue;
    }

    const line = match[2] === undefined ? null : Number(match[2]);
    const column = match[3] === undefined ? null : Number(match[3]);
    // Without a `:line`, a final `.` or `-` belongs to the sentence around the path.
    const path = line === null ? match[1].replace(/[.\-+@]+$/, "") : match[1];
    const absolute = path.startsWith("/");

    if (!/[A-Za-z]/.test(path) || (!absolute && !path.includes("/") && !hasFileExtension(path))) continue;

    const end = start + path.length + (line === null ? 0 : match[0].length - match[1].length);

    found.push({ start, end, target: { kind: "path", path, line, column } });
  }

  return found;
};

/** The absolute path a relative one names under `base` (U365); an absolute path stays as it is. */
export const resolvePath = (base: string, path: string): string => {
  if (path.startsWith("/")) return path;

  const parts = base.split("/").filter(Boolean);

  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }

  return `/${parts.join("/")}`;
};

type Cell = Pick<IBufferCell, "getChars" | "getWidth">;

/** The part of xterm's buffer a link needs: rows, whether each continues the one above, and their cells. */
export type Rows = {
  length: number;
  getLine(row: number): (Pick<IBufferLine, "isWrapped" | "length"> & { getCell(x: number): Cell | undefined }) | undefined;
};

type Where = { row: number; x: number; width: number };

/** One wrapped logical line as a string, with the cell each of its characters sits in. */
const logicalLine = (rows: Rows, row: number): { text: string; cells: Where[]; first: number } | null => {
  if (rows.getLine(row) === undefined) return null;

  let first = row;

  while (rows.getLine(first)?.isWrapped && first > 0) first -= 1;

  let text = "";
  const cells: Where[] = [];

  for (let at = first; at < rows.length; at += 1) {
    const line = rows.getLine(at);

    if (line === undefined || (at > first && !line.isWrapped)) break;

    for (let x = 0; x < line.length; x += 1) {
      const cell = line.getCell(x);
      const width = cell?.getWidth() ?? 1;

      // The right half of a wide character holds nothing of its own.
      if (width === 0) continue;

      const chars = cell?.getChars() || " ";

      text += chars;

      for (let unit = 0; unit < chars.length; unit += 1) cells.push({ row: at, x, width });
    }
  }

  return { text, cells, first };
};

/** The links on one row (0-based) of the buffer. A link that wraps is one link, found from every row it covers. */
export const linksOnRow = (rows: Rows, row: number, open: (target: LinkTarget, event: MouseEvent) => void): ILink[] => {
  const logical = logicalLine(rows, row);

  if (logical === null) return [];

  const links: ILink[] = [];

  for (const { start, end, target } of findTargets(logical.text)) {
    const from = logical.cells[start];
    const to = logical.cells[end - 1];

    if (from === undefined || to === undefined || row < from.row || row > to.row) continue;

    links.push({
      range: { start: { x: from.x + 1, y: from.row + 1 }, end: { x: to.x + to.width, y: to.row + 1 } },
      text: logical.text.slice(start, end),
      activate: (event) => open(target, event),
    });
  }

  return links;
};

/**
 * The link provider every Terminal registers (U365). Only Cmd opens a link: a plain click, or Ctrl, Shift or Alt without Cmd,
 * opens nothing. While Cmd is held the range under the pointer is underlined and the pointer is a hand.
 */
export const linkProvider = (
  rows: () => Rows,
  open: (target: LinkTarget) => void,
  cmd: CommandKey,
): ILinkProvider & { dispose(): void } => {
  let hovered: ILink | null = null;

  // xterm reads `decorations` once when the pointer arrives, then swaps in a live copy that repaints on assignment.
  const stop = cmd.onChange(() => {
    if (hovered?.decorations === undefined) return;

    hovered.decorations.underline = cmd.held();
    hovered.decorations.pointerCursor = cmd.held();
  });

  return {
    provideLinks: (y, provide) => {
      const links = linksOnRow(rows(), y - 1, (target, event) => { if (event.metaKey) open(target); });

      provide(links.length === 0 ? undefined : links.map((link) => {
        const shown: ILink = {
          ...link,
          decorations: { get underline() { return cmd.held(); }, get pointerCursor() { return cmd.held(); } },
          hover: () => { hovered = shown; },
          leave: () => { if (hovered === shown) hovered = null; },
        };

        return shown;
      }));
    },
    dispose: stop,
  };
};

export type CommandKey = { held(): boolean; onChange(listener: () => void): () => void };

/** Whether Cmd is down, from the window's own key events; it is up once the window loses focus. */
export const commandKey = (target: Window = window): CommandKey => {
  let held = false;
  const listeners = new Set<() => void>();

  const set = (now: boolean) => {
    if (now === held) return;

    held = now;
    listeners.forEach((listener) => listener());
  };

  const track = (event: KeyboardEvent) => set(event.metaKey);
  const lose = () => set(false);

  target.addEventListener("keydown", track, true);
  target.addEventListener("keyup", track, true);
  target.addEventListener("blur", lose);

  return {
    held: () => held,
    onChange: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size > 0) return;

        target.removeEventListener("keydown", track, true);
        target.removeEventListener("keyup", track, true);
        target.removeEventListener("blur", lose);
      };
    },
  };
};
