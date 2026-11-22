import type { DiffLineAnnotation, VirtualizedFileDiff } from "@pierre/diffs";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { copy } from "./copy";
import { sameRevisions } from "./fileState";
import { sideName } from "./lines";
import { hunkFunction, type Takes } from "./modules";
import type { LineSelection } from "./lines";
import type { Note, NoteFormDraft } from "./notes";
import diffStyles from "./diff.styles.css?inline";

/** U7676c: the mark a line draws for a field kept as unfinished work. */
export type Mark = { unfinished: true; side: "old" | "new"; start: number; end: number; text: string };

/** U7677d: the composer drawn under the last line of the range being noted. */
export type Composer = { composing: true; side: "old" | "new"; start: number; end: number; /** The note whose text this field edits; it is not drawn meanwhile. */ replacing?: number | undefined };

export type Annotated = Note | Mark | Composer;

/** U7677a: the lines a note covers on one side, and whether its field holds focus. */
export type Noted = { side: "old" | "new"; start: number; end: number; focused: boolean };

/** U7677e: the source a comparison holds at a note's lines, as the note retained it. */
const sourceAt = (value: FileComparison, note: Pick<Note, "side" | "start" | "end">) => {
  const content = value[note.side];

  if (content.kind !== "text") return undefined;
  const lines = content.text.split("\n");

  if (lines.at(-1) === "") lines.pop();

  return lines.slice(note.start - 1, note.end).join("\n");
};

/** U7677e: a Sent note whose retained source no longer matches the lines now shown (U2540b's older-context rule). */
export const outdated = (note: Note, value: FileComparison | undefined) => note.sent !== undefined && value !== undefined && !sameRevisions(note.comparison, value) && sourceAt(value, note) !== note.source;

/** U7677a: a note draws under its lines while its comparison is the open one, and a Sent note while its lines still read the same. */
const shown = (note: Note, value: FileComparison) => sameRevisions(note.comparison, value) || (note.sent !== undefined && note.comparison.newPath === value.newPath && !outdated(note, value));

/** U7676c: what the diff draws under its lines: the open field first, so no saved note shifts the position Pierre keys its element by; each note of the open comparison under its last line; each unfinished field as a mark. */
export const lineAnnotations = (value: FileComparison | undefined, notes: readonly Note[], unfinished: readonly NoteFormDraft[], composer?: Composer): DiffLineAnnotation<Annotated>[] => [
  ...(composer ? [{ side: sideName(composer.side), lineNumber: composer.end, metadata: composer }] : []),
  ...notes.flatMap((note): DiffLineAnnotation<Note>[] => value && shown(note, value) && note.id !== composer?.replacing ? [{ side: sideName(note.side), lineNumber: note.end, metadata: note }] : []),
  ...unfinished.flatMap((draft): DiffLineAnnotation<Mark>[] => value && draft.comparison.newPath === value.newPath && sameRevisions(draft.comparison, value) && Number.isInteger(Number(draft.end)) && Number(draft.end) >= 1
    ? [{ side: sideName(draft.side), lineNumber: Number(draft.end), metadata: { unfinished: true, side: draft.side, start: Number(draft.start), end: Number(draft.end), text: draft.text } }]
    : []),
];

/** U7676c: draws the annotations under their lines, opens the folds that hide them (U7692b: an unchanged line is a new-side line) and keeps the focused line selected (U7676a). */
export const annotate = (view: VirtualizedFileDiff<Annotated>, lines: readonly DiffLineAnnotation<Annotated>[], at: LineSelection) => {
  view.render({ lineAnnotations: [...lines] });

  for (const { side, lineNumber, metadata } of lines) if (side === "additions") { view.revealLine(metadata.start); view.revealLine(lineNumber); }

  view.setSelectedLines({ side: sideName(at.side), start: at.start, end: at.end });
};

/** U7676c: the notes whose comparison is not the open one; they stay in the batch and gather after the file's last line. */
export const gatheredNotes = (value: FileComparison | undefined, notes: readonly Note[]) => value ? notes.filter(note => note.comparison.newPath === value.newPath && !shown(note, value)) : [];

/** U7674d: the diff is light in both App modes. */
const DIFF_THEME = "github-light";

let library: Promise<typeof import("@pierre/diffs")> | undefined;

/** U2540d: startup and Agent selection never fetch the renderer. */
export const diffsLoaded = () => library !== undefined;

/** U7610c: ends the task the caller runs in, so a large rewrite's steps each leave the page a turn between them. */
const yielded = () => new Promise(resolve => setTimeout(resolve));

type PatchFile = { name: string; contents: string };

const MAX_EDITS = 2000;

/** The fewest line insertions and deletions any diff from `old` to `next` needs: each line the other text lacks, counted with its repeats. */
const lineEditFloor = (old: string, next: string) => {
  const lines = (text: string) => text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const before = lines(old);
  const after = lines(next);
  const left = new Map<string, number>();

  for (const line of before) left.set(line, (left.get(line) ?? 0) + 1);
  let shared = 0;

  for (const line of after) {
    const count = left.get(line) ?? 0;

    if (count > 0) { shared += 1; left.set(line, count - 1); }
  }

  return before.length + after.length - 2 * shared;
};

/** U2540’s 10,000-line complete rewrite froze the rendered observer beyond 30 seconds.
 * jsdiff bounds that search; its empty-side patches supply a lossless coarse fallback.
 * U7610b: a rewrite that needs more edits than the bound skips the search, which cannot succeed, and its 100 ms timeout. */
const patchOf = async (oldFile: PatchFile, newFile: PatchFile, { createTwoFilesPatch, structuredPatch, formatPatch }: Pick<typeof import("diff"), "createTwoFilesPatch" | "structuredPatch" | "formatPatch">) => {
  const patch = lineEditFloor(oldFile.contents, newFile.contents) > MAX_EDITS ? undefined : createTwoFilesPatch(oldFile.name, newFile.name, oldFile.contents, newFile.contents, undefined, undefined, { timeout: 100, maxEditLength: MAX_EDITS });

  if (patch !== undefined) return { patch, coarse: false };

  await yielded();
  const removed = structuredPatch(oldFile.name, newFile.name, oldFile.contents, "");

  await yielded();
  const added = structuredPatch(oldFile.name, newFile.name, "", newFile.contents);

  await yielded();
  const before = removed.hunks[0];
  const after = added.hunks[0];

  return { coarse: true, patch: formatPatch({ ...removed, hunks: [{
    oldStart: before?.oldStart ?? 0, oldLines: before?.oldLines ?? 0,
    newStart: after?.newStart ?? 0, newLines: after?.newLines ?? 0,
    lines: [...(before?.lines ?? []), ...(after?.lines ?? [])],
  }] }) };
};


/** U7678c: one scroll that a module's files share, and the one Virtualizer its views hang from. */
export type Shared = { scroller: HTMLElement | undefined; virtualizer?: InstanceType<typeof import("@pierre/diffs").Virtualizer> | undefined };

/** U7683d: the hunks of `patch` with a changed line `pick` takes, the header kept; every hunk when none is taken, so a section never draws nothing. */
export const keepHunks = (patch: string, pick: Takes): string => {
  const lines = patch.split("\n");
  const first = lines.findIndex(line => line.startsWith("@@"));

  if (first === -1) return patch;

  const kept: string[] = [];
  let hunk: string[] = [];
  let taken = false;
  let old = 0;
  let next = 0;

  const close = () => {
    if (taken) kept.push(...hunk);
    hunk = [];
    taken = false;
  };

  for (const line of lines.slice(first)) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);

    if (header) {
      close();
      old = Number(header[1]);
      next = Number(header[2]);
    } else if (line.startsWith("+")) taken ||= pick("new", next++);
    else if (line.startsWith("-")) taken ||= pick("old", old++);
    else if (line.startsWith(" ")) { old++; next++; }

    hunk.push(line);
  }

  close();

  return kept.length === 0 ? patch : [...lines.slice(0, first), ...kept].join("\n").replace(/\n*$/, "\n");
};

/** U7678c: each hunk header gains the function line git's default would name, read from the old text above the hunk. */
const withFunctions = (patch: string, old: string) => {
  const lines = old.split("\n");

  return patch.replace(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@$/gm, (header, start: string) => {
    const name = hunkFunction(lines, Number(start));

    return name === undefined ? header : `${header} ${name}`;
  });
};

/** U7678c: the fold above a hunk names the hunk's function beside its count: Pierre draws a hunk's context only in a separator that cannot reveal lines. */
const nameHunks = (node: HTMLElement, functions: readonly (string | undefined)[]) => {
  for (const content of node.shadowRoot?.querySelectorAll<HTMLElement>("[data-gutter] [data-separator=line-info][data-expand-index] [data-separator-content]") ?? []) {
    const name = functions[Number(content.closest<HTMLElement>("[data-separator]")?.dataset.expandIndex)];

    if (!name || content.querySelector("[data-hunk-function]")) continue;
    const span = document.createElement("span");

    span.dataset.hunkFunction = "";
    span.textContent = name;
    content.append(span);
  }
};

type Hooks = {
  shared?: Shared | undefined;
  current: () => boolean;
  selection: () => LineSelection;
  /** A line number was clicked: the range now selected. */
  pick: (range: LineSelection) => void;
  /** U7676a: the gutter + or a drag over line numbers asks for a note on this range. */
  note: (range: LineSelection) => void;
  /** U7677: the element an annotation draws as; the reader owns what it holds. */
  annotation: (metadata: Annotated) => HTMLElement;
  /** U7683d: a flow's section draws only the hunks with a changed line this takes. */
  only?: Takes | undefined;
};

/** Pierre's range as the App's selection: its side named for the App, its ends in line order whichever way it ran. */
const inLineOrder = (range: { side?: "deletions" | "additions"; start: number; end: number }): LineSelection => ({ side: range.side === "deletions" ? "old" : "new", start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) });

/** What the reader holds once the diff of `value` is built in `mount`: the view, its virtualizer and container, and the parsed diff it draws. */
export type Drawn = { mark: (ranges: readonly Noted[]) => void; view: VirtualizedFileDiff<Annotated>; virtualizer: InstanceType<typeof import("@pierre/diffs").Virtualizer>; container: HTMLElement; fileDiff: NonNullable<ReturnType<typeof import("@pierre/diffs").processFile>>; coarse: boolean };

/** U7678c: the module scroll's one Virtualizer, made on the first file drawn; undefined outside a shared scroll. */
const sharedVirtualizer = (shared: Shared | undefined, Virtualizer: typeof import("@pierre/diffs").Virtualizer) => {
  if (!shared?.scroller) return undefined;

  if (!shared.virtualizer) {
    shared.virtualizer = new Virtualizer();
    shared.virtualizer.setup(shared.scroller);
  }

  return shared.virtualizer;
};

/** Builds Pierre's view of one comparison; undefined when `hooks.current` went false on the way. */
export const drawDiff = async (value: FileComparison, mount: HTMLElement, hooks: Hooks): Promise<Drawn | undefined> => {
  const { VirtualizedFileDiff, Virtualizer, processFile, preloadHighlighter, getFiletypeFromFileName } = await (library ??= import("@pierre/diffs").then(module => {
    // U7674d: the library ships no themes in this build; Pierre's own github-light, a Zed theme for Highlights, loads on first use.
    module.registerCustomTheme(DIFF_THEME, () => import("@pierre/highlights/themes/github-light"), "zed");

    return module;
  }));

  const { createTwoFilesPatch, structuredPatch, formatPatch } = await import("diff");

  if (!hooks.current()) return undefined;

  const oldFile = { name: value.oldPath, contents: value.old.kind === "text" ? value.old.text : "" };
  const newFile = { name: value.newPath, contents: value.new.kind === "text" ? value.new.text : "" };
  await yielded();

  if (!hooks.current()) return undefined;

  const made = await patchOf(oldFile, newFile, { createTwoFilesPatch, structuredPatch, formatPatch });
  const { coarse } = made;

  await yielded();
  const patch = withFunctions(hooks.only ? keepHunks(made.patch, hooks.only) : made.patch, oldFile.contents);

  // U2540's 10,000-line observer exceeded the browser bound with a full DOM; Pierre owns the visible window.
  const container = document.createElement("diffs-container");
  mount.append(container);
  const virtualizer = sharedVirtualizer(hooks.shared, Virtualizer) ?? new Virtualizer();

  let noted: readonly Noted[] = [];

  let functions: readonly (string | undefined)[] = [];

  const stamp = (node: HTMLElement) => {
    nameHunks(node, functions);

    for (const line of node.shadowRoot?.querySelectorAll<HTMLElement>("[data-line]") ?? []) {
      const side = line.getAttribute("data-line-type") === "change-deletion" ? "old" : "new";
      const number = Number(line.getAttribute("data-line"));
      const hit = noted.filter(range => range.side === side && range.start <= number && number <= range.end);

      line.toggleAttribute("data-noted", hit.length > 0);
      line.toggleAttribute("data-focused", hit.some(range => range.focused));
    }
  };

  const view = new VirtualizedFileDiff<Annotated>({
    onLineNumberClick: ({ lineNumber, annotationSide, event }) => {
      const side = annotationSide === "deletions" ? "old" : "new";
      const old = hooks.selection();
      const extend = event.shiftKey && old.side === side;
      const range: LineSelection = { side, start: extend ? Math.min(old.start, lineNumber) : lineNumber, end: extend ? Math.max(old.start, lineNumber) : lineNumber };

      view.setSelectedLines({ side: annotationSide, start: range.start, end: range.end });
      hooks.pick(range);
    },
    // Reuse: Pierre's own gutter utility and line selection; its + sits on the line number and takes its look only through unsafeCSS on [data-utility-button].
    enableGutterUtility: true,
    enableLineSelection: true,
    onGutterUtilityClick: range => {
      const picked = inLineOrder(range);

      view.setSelectedLines({ side: range.side ?? "additions", start: picked.start, end: picked.end });
      hooks.pick(picked);
      hooks.note(picked);
    },
    // A drag leaves its range selected: the App's selection follows it before the field opens.
    onLineSelectionEnd: range => {
      if (!range || range.start === range.end) return;
      const picked = inLineOrder(range);

      hooks.pick(picked);
      hooks.note(picked);
    },
    renderAnnotation: ({ metadata }) => hooks.annotation(metadata),
    // U7677a: Pierre has no line decoration API, so each noted line carries the attribute the stylesheet keys on, again after each render.
    onPostRender: node => stamp(node),
    theme: DIFF_THEME, lineDiffType: coarse ? "none" : "word-alt", overflow: "wrap", preferredHighlighter: "highlights", diffStyle: "unified", diffIndicators: "classic", disableFileHeader: true, unsafeCSS: diffStyles }, virtualizer, { lineHeight: parseFloat(getComputedStyle(mount).getPropertyValue("--space-5")) || 24 });

  // U7610b: the first file opens with the list, so each step of a large rewrite yields to the page before the next.
  await yielded();

  if (!hooks.current()) return undefined;

  const fileDiff = processFile(patch, { oldFile, newFile, throwOnError: true });

  if (!fileDiff) throw new Error(copy.comparisonRenderFailed);

  functions = fileDiff.hunks.map(hunk => hunk.hunkContext);

  await yielded();

  if (!hooks.current()) return undefined;

  // Pierre anchors a visible file of no height to its bottom, so a first render left waiting on the highlighter opened the diff at its last line.
  await preloadHighlighter({ themes: [DIFF_THEME], langs: [...new Set([oldFile.name, newFile.name].map(getFiletypeFromFileName))], preferredHighlighter: "highlights" });

  // U7610c: the reader's first render of the view is a task of its own.
  await yielded();

  return hooks.current() ? { mark: ranges => { noted = ranges; stamp(container); }, view, virtualizer, container, fileDiff, coarse } : undefined;
};
