import type { LanguageId, SemanticDiffOperation } from "@plannotator/sem-jiff";

/** A line range of a file, 1-based and inclusive. */
export type Lines = { start: number; end: number };

/**
 * U7696a: code the reader found moved or renamed within one file, on the new side. `lines` are the new lines it holds, in order, and its label sits under the first range.
 * A move names where its lines stood; a rename names the old and the new identifier.
 */
export type Moved = { kind: "moved"; lines: readonly Lines[]; from: Lines } | { kind: "renamed"; lines: readonly Lines[]; was: string; now: string };

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
export const movedOf = (operations: readonly SemanticDiffOperation[], language: LanguageId, texts: { old: string; new: string }): Moved[] => operations.flatMap((operation): Moved[] => {
  const lines = rangesOf(operation.lines.new);
  const before = rangesOf(operation.lines.old);
  const first = before[0];
  const last = before.at(-1);
  const kinds = READS[language] ?? [];

  if (lines.length === 0 || !first || !last) return [];

  if (operation.type === "moved" && kinds.includes("moved")) return [{ kind: "moved", lines, from: { start: first.start, end: last.end } }];

  const span = operation.spans[0];
  const was = span && textAt(texts.old, span.old);
  const now = span && textAt(texts.new, span.new);

  return operation.type === "renamed" && kinds.includes("renamed") && was && now && was !== now ? [{ kind: "renamed", lines, was, now }] : [];
});

/** U7696a: the line a mark's label sits under: the last line of its first range. */
export const labelLine = (moved: Moved) => moved.lines[0]?.end ?? 0;
