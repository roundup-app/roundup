import type { VirtualizedFileDiff } from "@pierre/diffs";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { copy } from "./copy";
import { selectedNotice } from "./fileState";
import type { LineSelection } from "./lines";
import type { Note } from "./notes";
import diffStyles from "./diff.styles.css?inline";

/** U7676c: the mark a line draws for a field kept as unfinished work. */
export type Mark = { unfinished: true; side: "old" | "new"; start: number; end: number; text: string };

export type Annotated = Note | Mark;

/** U7674d: the diff is light in both App modes. */
const DIFF_THEME = "github-light";

let library: Promise<typeof import("@pierre/diffs")> | undefined;

/** U2540d: startup and Agent selection never fetch the renderer. */
export const diffsLoaded = () => library !== undefined;

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
const patchOf = (oldFile: PatchFile, newFile: PatchFile, { createTwoFilesPatch, structuredPatch, formatPatch }: Pick<typeof import("diff"), "createTwoFilesPatch" | "structuredPatch" | "formatPatch">) => {
  const patch = lineEditFloor(oldFile.contents, newFile.contents) > MAX_EDITS ? undefined : createTwoFilesPatch(oldFile.name, newFile.name, oldFile.contents, newFile.contents, undefined, undefined, { timeout: 100, maxEditLength: MAX_EDITS });

  if (patch !== undefined) return { patch, coarse: false };

  const removed = structuredPatch(oldFile.name, newFile.name, oldFile.contents, "");
  const added = structuredPatch(oldFile.name, newFile.name, "", newFile.contents);
  const before = removed.hunks[0];
  const after = added.hunks[0];

  return { coarse: true, patch: formatPatch({ ...removed, hunks: [{
    oldStart: before?.oldStart ?? 0, oldLines: before?.oldLines ?? 0,
    newStart: after?.newStart ?? 0, newLines: after?.newLines ?? 0,
    lines: [...(before?.lines ?? []), ...(after?.lines ?? [])],
  }] }) };
};


type Hooks = {
  current: () => boolean;
  selection: () => LineSelection;
  /** A line number was clicked: the range now selected. */
  pick: (range: LineSelection) => void;
  /** U7676a: the gutter + or a drag over line numbers asks for a note on this range. */
  note: (range: LineSelection) => void;
};

/** What the reader holds once the diff of `value` is built in `mount`: the view, its virtualizer and container, and the parsed diff it draws. */
export type Drawn = { view: VirtualizedFileDiff<Annotated>; virtualizer: InstanceType<typeof import("@pierre/diffs").Virtualizer>; container: HTMLElement; fileDiff: NonNullable<ReturnType<typeof import("@pierre/diffs").processFile>>; coarse: boolean };

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
  const { patch, coarse } = patchOf(oldFile, newFile, { createTwoFilesPatch, structuredPatch, formatPatch });

  // U2540's 10,000-line observer exceeded the browser bound with a full DOM; Pierre owns the visible window.
  const container = document.createElement("diffs-container");
  mount.append(container);
  const virtualizer = new Virtualizer();

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
      const picked: LineSelection = { side: range.side === "deletions" ? "old" : "new", start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) };

      view.setSelectedLines({ side: range.side ?? "additions", start: picked.start, end: picked.end });
      hooks.pick(picked);
      hooks.note(picked);
    },
    onLineSelectionEnd: range => {
      if (!range || range.start === range.end) return;
      hooks.note({ side: range.side === "deletions" ? "old" : "new", start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) });
    },
    renderAnnotation: ({ metadata }) => {
      if ("unfinished" in metadata) {
        const mark = document.createElement("button");

        mark.type = "button";
        mark.className = "diff-note";
        mark.textContent = copy.unfinishedWork;
        // listener-owner: Pierre builds the mark for its annotation and drops it with the line.
        mark.addEventListener("click", () => hooks.note({ side: metadata.side, start: metadata.start, end: metadata.end }));

        return mark;
      }

      const element = document.createElement("p");

      element.className = "diff-note";
      element.textContent = `${selectedNotice(metadata)}: ${metadata.text}`;

      return element;
    },
    theme: DIFF_THEME, lineDiffType: coarse ? "none" : "word-alt", overflow: "wrap", preferredHighlighter: "highlights", diffStyle: "unified", diffIndicators: "classic", disableFileHeader: true, unsafeCSS: diffStyles }, virtualizer, { lineHeight: parseFloat(getComputedStyle(mount).getPropertyValue("--space-5")) || 24 });

  // U7610b: the first file opens with the list, so each step of a large rewrite yields to the page before the next.
  await new Promise(resolve => setTimeout(resolve));

  if (!hooks.current()) return undefined;

  const fileDiff = processFile(patch, { oldFile, newFile, throwOnError: true });

  if (!fileDiff) throw new Error(copy.comparisonRenderFailed);

  await new Promise(resolve => setTimeout(resolve));

  if (!hooks.current()) return undefined;

  // Pierre anchors a visible file of no height to its bottom, so a first render left waiting on the highlighter opened the diff at its last line.
  await preloadHighlighter({ themes: [DIFF_THEME], langs: [...new Set([oldFile.name, newFile.name].map(getFiletypeFromFileName))], preferredHighlighter: "highlights" });

  return hooks.current() ? { view, virtualizer, container, fileDiff, coarse } : undefined;
};
