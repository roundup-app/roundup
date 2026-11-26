import type { LanguageId, SemanticDiffOperation } from "@plannotator/sem-jiff";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { Takes } from "./modules";

/** A line range of a file, 1-based and inclusive. */
export type Lines = { start: number; end: number };

/**
 * U7696a: code that moved or was renamed rather than written new, on the new side. `lines` are the new lines it holds, in order, and its label sits under the first range.
 * A move names the file and lines where its code stood (U7696d: another file's when the code left it); a rename names the old and the new identifier.
 */
export type Moved = { kind: "moved"; lines: readonly Lines[]; from: Lines & { path: string } } | { kind: "renamed"; lines: readonly Lines[]; was: string; now: string };

/** The two bodies of one file. */
export type MoveRequest = { path: string; old: string; new: string };

/**
 * U7696a: what each language's reader may claim. The library holds back, from its 0.2.1 and 0.2.2 releases on, what its blind tests found wrong more than 1 time in 50: Swift and Ruby moves and renames, Kotlin renames, and a move that was also edited in every language. The App pins 0.2.0, which still claims those, so it draws only what this table lists, and a language not in it is not read and loads no grammar. Kotlin and C# are left out for the size of their grammars.
 */
export const READS: Readonly<Partial<Record<LanguageId, readonly Moved["kind"][]>>> = {
  typescript: ["moved", "renamed"], tsx: ["moved", "renamed"], python: ["moved", "renamed"], go: ["moved", "renamed"], rust: ["moved", "renamed"], java: ["moved", "renamed"], php: ["moved", "renamed"],
};

/** The library skips a file over this many characters, old and new together, and draws a plain diff. */
export const MAX_CHARS = 2_000_000;

/** U7696a: whether a language is read and the two bodies are within the library's cap. */
export const readable = (language: LanguageId | null, old: string, next: string): language is LanguageId => language !== null && READS[language] !== undefined && old.length + next.length <= MAX_CHARS;

const rangesOf = (regions: readonly Lines[]): Lines[] => regions.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start - b.start);

/** The text of the first range of one side of a span, when it sits on one line. */
const textAt = (text: string, ranges: SemanticDiffOperation["spans"][number]["old"]) => {
  const at = ranges?.[0];

  return at && at.start.line === at.end.line ? text.split("\n")[at.start.line - 1]?.slice(at.start.character, at.end.character) : undefined;
};

/** U7696a: the moved and renamed operations a language may claim, as the marks of the new side; every other operation is a plain edit. */
export const movedOf = (operations: readonly SemanticDiffOperation[], language: LanguageId, texts: MoveRequest): Moved[] => operations.flatMap((operation): Moved[] => {
  const lines = rangesOf(operation.lines.new);
  const before = rangesOf(operation.lines.old);
  const first = before[0];
  const last = before.at(-1);
  const kinds = READS[language] ?? [];

  if (lines.length === 0 || !first || !last) return [];

  if (operation.type === "moved" && kinds.includes("moved")) return [{ kind: "moved", lines, from: { path: texts.path, start: first.start, end: last.end } }];

  const span = operation.spans[0];
  const was = span && textAt(texts.old, span.old);
  const now = span && textAt(texts.new, span.new);

  return operation.type === "renamed" && kinds.includes("renamed") && was && now && was !== now ? [{ kind: "renamed", lines, was, now }] : [];
});

/** U7696a: the line a mark's label sits under: the last line of its first range. */
export const labelLine = (moved: Moved) => moved.lines[0]?.end ?? 0;

/** U7696a: whether a mark holds the new-side line. */
export const holds = (moved: Moved, line: number) => moved.lines.some(range => range.start <= line && line <= range.end);

/** U7696f: whether a mark names the function or type at `span`: a move when its first line moved, a rename when any of its lines carry one. */
export const names = (moved: Moved, span: { start: number; end: number }) => moved.kind === "moved" ? holds(moved, span.start) : moved.lines.some(range => range.start <= span.end && span.start <= range.end);

/** U7696e: what a repeat's lines still show once the lines of the moves are taken out: moved code is not also marked a repeat. */
export const apart = (only: Takes | undefined, moves: readonly Moved[]): Takes | undefined => moves.length === 0 ? only : (side, line) => (only?.(side, line) ?? true) && !(side === "new" && moves.some(moved => holds(moved, line)));

/** The fewest non-blank lines a body needs before a match across files says anything: a line or two of boilerplate repeats by chance. */
const MIN_BODY = 3;

const bodyOf = (text: string, span: Lines) => text.split("\n").slice(span.start - 1, span.end).map(line => line.trim()).filter(line => line !== "");

/** U7696d: the functions and types whose code left one file and arrived in another: one removed and one added symbol of one name and kind in the changes, in two files. The listing holds no body: the match is a pair to read. */
export type Left = { from: ChangedSymbol & { old: Lines }; to: ChangedSymbol & { new: Lines } };

export const leftFiles = (symbols: readonly ChangedSymbol[]): Left[] => {
  const tail = (symbol: ChangedSymbol) => symbol.key.slice(symbol.path.length + 1);
  const byTail = (status: ChangedSymbol["status"]) => Map.groupBy(symbols.filter(symbol => symbol.status === status && symbol.kind !== "topLevel"), tail);
  const came = byTail("added");

  return [...byTail("removed")].flatMap(([name, gone]) => {
    const [from] = gone;
    const [to] = came.get(name) ?? [];

    return gone.length === 1 && came.get(name)?.length === 1 && from?.old && to?.new && from.path !== to.path ? [{ from: { ...from, old: from.old }, to: { ...to, new: to.new } }] : [];
  });
};

/** U7696d: the two sides read the same, ignoring indentation and blank lines, over at least three lines. */
export const sameBody = (before: string, from: Lines, after: string, to: Lines) => {
  const body = bodyOf(before, from);

  return body.length >= MIN_BODY && body.join("\n") === bodyOf(after, to).join("\n");
};

/** U7696d: the mark a confirmed cross-file pair draws on the new side. */
export const arrived = ({ from, to }: Left): Moved => ({ kind: "moved", lines: [to.new], from: { path: from.path, start: from.old.start, end: from.old.end } });
