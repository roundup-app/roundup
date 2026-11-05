import { RpcError } from "../app/seam";
import type { OpenTarget } from "../app/seam";

/** A printed web link, or a path as printed: absolute or relative, with the line (and ignored column) it was printed with. */
export type Printed = { kind: "url"; url: string } | { kind: "path"; path: string; line: number | null };

export type Found = { start: number; end: number; printed: Printed };

const LEADING = /^[("'[]+/;

const TRAILING = /[.,;)'"]+$/;

const PATH_TRAILING = /[.,;:)'"\]]+$/;

const PATH = /^(.+?)(?::(\d+)(?::\d+)?)?$/;

const EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;

const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

const NOT_FOUND = -32001;

type Parse = typeof import("tldts").parse;

let parseHost: Parse | null = null;

/** The public suffix list is a separate chunk (entry budget R3800): a bare domain is a link once it has loaded. */
export const suffixesLoaded: Promise<void> = import("tldts").then((module) => {
  parseHost = module.parse;
});

/** U365b: `https://` plus a printed token whose host has two or more labels and ends in an ICANN public suffix (bundled list, no lookup); null otherwise. */
export const bareDomainUrl = (token: string): string | null => {
  if (/^[/.~]|@|:/.test(token)) return null;

  const host = token.split(/[/?#]/, 1)[0] ?? "";
  const labels = host.split(".");

  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;

  if (parseHost === null) return null;

  const parsed = parseHost(host, { allowPrivateDomains: false });

  return parsed.isIcann && parsed.domain !== null ? `https://${token}` : null;
};

const urlAt = (token: string, objectLinks: boolean): string | null =>
  (/^https?:\/\/\S/i.test(token) || (objectLinks && /^roundup:\/\/\S/i.test(token))) ? token.replace(TRAILING, "") : null;

const pathAt = (token: string): Printed | null => {
  const parts = PATH.exec(token);
  const path = parts?.[1];

  if (!path || path === "/") return null;

  if (!path.includes("/") && /@|^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return null;

  if (!path.includes("/", path.startsWith("/") ? 1 : 0) && !EXTENSION.test(path) && !bareDomainUrl(path)) return null;

  return { kind: "path", path, line: parts[2] ? Number(parts[2]) : null };
};

/** U365: every web link and path in `text`, by character range; a token that is neither is no link. */
export const findTargets = (text: string, objectLinks = false): Found[] => {
  const found: Found[] = [];

  for (const match of text.matchAll(/\S+/g)) {
    const lead = LEADING.exec(match[0])?.[0].length ?? 0;
    const token = match[0].slice(lead);
    const start = match.index + lead;
    const url = urlAt(token, objectLinks);

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
  if (path === "~" || path.startsWith("~/")) return path;

  const parts: string[] = [];

  for (const part of (path.startsWith("/") ? path : `${base}/${path}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }

  return `/${parts.join("/")}`;
};

/** U365b: opens a printed target through `openTarget`; a path is asked for first, and a bare domain that is missing opens as `https://` once. Returns the failure line, or null. */
export const openPrinted = async (
  openTarget: (target: OpenTarget) => Promise<void>,
  printed: Printed,
  base: string,
  doesNotExist: (path: string) => string,
): Promise<string | null> => {
  const path = printed.kind === "path" ? absolutePath(printed.path, base) : "";

  try {
    await openTarget(printed.kind === "url" ? printed : { kind: "path", path, line: printed.line });

    return null;
  } catch (thrown) {
    if (!(thrown instanceof Error)) throw thrown;

    if (printed.kind !== "path" || !(thrown instanceof RpcError) || thrown.code !== NOT_FOUND) return thrown.message;

    const url = printed.line === null ? bareDomainUrl(printed.path) : null;

    if (url === null) return doesNotExist(path);

    try {
      await openTarget({ kind: "url", url });

      return null;
    } catch (refused) {
      if (!(refused instanceof Error)) throw refused;

      return refused.message;
    }
  }
};
