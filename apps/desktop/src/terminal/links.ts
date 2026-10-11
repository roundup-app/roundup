/** A printed web link, or a path as printed: absolute or relative, with the line (and ignored column) it was printed with. */
export type Printed = { kind: "url"; url: string } | { kind: "path"; path: string; line: number | null };

export type Found = { start: number; end: number; printed: Printed };

const LEADING = /^[("'[]+/;

const TRAILING = /[.,;)'"]+$/;

const PATH_TRAILING = /[.,;:)'"\]]+$/;

const PATH = /^(.+?)(?::(\d+)(?::\d+)?)?$/;

const EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;

const urlAt = (token: string): string | null => /^https?:\/\/\S/i.test(token) ? token.replace(TRAILING, "") : null;

const pathAt = (token: string): Printed | null => {
  const parts = PATH.exec(token);
  const path = parts?.[1];

  if (!path || path === "/") return null;

  const absolute = path.startsWith("/");

  if (!absolute && !path.includes("/") && !EXTENSION.test(path)) return null;

  return { kind: "path", path, line: parts[2] ? Number(parts[2]) : null };
};

/** U365: every web link and path in `text`, by character range; a token that is neither is no link. */
export const findTargets = (text: string): Found[] => {
  const found: Found[] = [];

  for (const match of text.matchAll(/\S+/g)) {
    const lead = LEADING.exec(match[0])?.[0].length ?? 0;
    const token = match[0].slice(lead);
    const start = match.index + lead;
    const url = urlAt(token);

    if (url !== null) {
      found.push({ start, end: start + url.length, printed: { kind: "url", url } });

      continue;
    }

    const trimmed = token.replace(PATH_TRAILING, "");
    const printed = pathAt(trimmed);

    if (printed) found.push({ start, end: start + trimmed.length, printed });
  }

  return found;
};

/** The absolute path a printed path means: a relative one is joined to `base` (the Agent's Worktree, or the Project folder), `.` and `..` folded. */
export const absolutePath = (path: string, base: string): string => {
  const parts: string[] = [];

  for (const part of (path.startsWith("/") ? path : `${base}/${path}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }

  return `/${parts.join("/")}`;
};
