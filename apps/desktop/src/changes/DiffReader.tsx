import { copy } from "./copy";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import type { VirtualizedFileDiff } from "@pierre/diffs";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import type { CompareFileParams } from "@contracts/agent/CompareFileParams";
import { useConnectedProject } from "../state/connectedProject";
import { StatusNote } from "../ink/MountedLine";
import { createMessageToast } from "../ink/messageToast";
import { failureOf } from "../app/failureOf";
import { reply } from "./notes";
import { changeStarts } from "./lines";
import type { ChangeStart, Places } from "./lines";
import type { Note, Notes } from "./notes";
import { NoteForm } from "./NoteForm";
import { NoteBatch } from "./NoteBatch";
import diffStyles from "./diff.styles.css?inline";

/** U7674d: the diff is light in both App modes. */
const DIFF_THEME = "github-light";

let library: Promise<typeof import("@pierre/diffs")> | undefined;

/** U2540d: startup and Agent selection never fetch the renderer. */
export const diffsLoaded = () => library !== undefined;

const compareParams = (id: string, path: string, to: CompareTarget): CompareFileParams => ({ id, path, to });

type PatchFile = { name: string; contents: string };

const MAX_EDITS = 2000;

/** U7675b: a side over this many lines is offered with Show anyway, not drawn at once. */
const TOO_LARGE_LINES = 20000;

const lineCount = (text: string) => text.split("\n").length;

const withoutSpace = (text: string) => text.replace(/\s+/g, "");

/** U7675e: what the pane lets the view do from a key. */
export type DiffKeys = { focus: () => void; step: (direction: 1 | -1) => void };

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

/** One read-only comparison, fetched only after View diff. */
export const DiffReader = (props: { id: string; name: string; path: string; blob?: string | null | undefined; places?: Places | undefined; keys?: ((keys: DiffKeys) => void) | undefined; to?: CompareTarget | undefined; notes: Notes; editing?: Note | undefined; onEdited: () => void; recover: () => void }) => {
  const { app, worktrees } = useConnectedProject();
  const [selection, setSelection] = createSignal<{ side: "old" | "new"; start: number; end: number }>({ side: "new", start: 1, end: 1 });
  const [form, setForm] = createSignal<{ comparison: FileComparison; selection: ReturnType<typeof selection>; editing?: Note }>();

  createEffect(() => props.editing, note => {
    if (note) setForm({ comparison: note.comparison, selection: note, editing: note });
  });

  let addButton: HTMLButtonElement | undefined;
  const closeForm = () => { setForm(undefined); props.onEdited(); addButton?.focus(); };

  let displayed: { id: string; path: string } | undefined;
  const [renderer, setRenderer] = createSignal<VirtualizedFileDiff<Note>>();
  const [read, setRead] = createSignal<FileComparison>();
  const [failure, setFailure] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [coarse, setCoarse] = createSignal(false);
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [slow, setSlow] = createSignal(false);
  const [painted, setPainted] = createSignal<{ path: string; blob: string | null }>({ path: props.path, blob: props.blob ?? null });
  const [shown, setShown] = createSignal<{ path: string; kind: "whitespace" | "large" }>();
  let starts: ChangeStart[] = [];
  let cursor = -1;
  let rendered: string | undefined;
  let focusHost = () => {};
  let moveTo = (_side: "old" | "new", _line: number) => {};

  // U7675b: a read of a file whose entry's blob moved on says so and waits for Reload.
  const updated = () => !loading() && painted().path === props.path && painted().blob !== (props.blob ?? null);

  const hidden = createMemo(() => {
    const value = read();

    if (!value || value.status === null || value.old.kind === "binary" || value.new.kind === "binary") return null;
    const oldText = value.old.kind === "text" ? value.old.text : "";
    const newText = value.new.kind === "text" ? value.new.text : "";
    const revealed = shown()?.path === props.path ? shown()?.kind : undefined;

    if (value.old.kind === "text" && value.new.kind === "text" && oldText === newText) return "mode" as const;

    if (revealed !== "large" && (lineCount(oldText) > TOO_LARGE_LINES || lineCount(newText) > TOO_LARGE_LINES)) return "large" as const;

    if (revealed !== "whitespace" && value.old.kind === "text" && value.new.kind === "text" && withoutSpace(oldText) === withoutSpace(newText)) return "whitespace" as const;

    return null;
  });

  const notice = createMemo(() => {
    const value = read();

    if (loading() && slow()) return copy.loadingFile(props.path);

    if (!value) return loading() ? null : failure() ? null : copy.diffNotLoaded;

    if (value.status === null) return copy.noDifference;

    if (hidden() === "mode") return copy.modeOnly;

    if (hidden() === "whitespace") return copy.noDifference;

    if (hidden() === "large") return copy.tooLarge;

    if (value.old.kind === "binary" || value.new.kind === "binary") return copy.binaryDiff;

    return coarse() ? copy.replacementDiff : copy.selectedLines(selection().side, selection().start === selection().end ? `${selection().start}` : `${selection().start}–${selection().end}`, selection().start === selection().end);
  });

  let stopLoading = () => {};

  const load = (params: CompareFileParams) => {
    stopLoading();
    setLoading(true);
    setSlow(false);
    setPainted({ path: params.path, blob: untrack(() => props.blob) ?? null });
    const timer = setTimeout(() => setSlow(true), 150);
    const target = { id: params.id, path: params.path };
    let current = true;
    void reply(() => app.rpc("agent.compareFile", params)).then(result => {
      if (!current) return;

      clearTimeout(timer);
      setLoading(false);
      if (result.kind === "ok") {
        setRead(previous => {
          const next = result.value;

          const equal = displayed?.id === target.id && displayed.path === target.path && previous
            && previous.base === next.base && previous.oldPath === next.oldPath && previous.newPath === next.newPath
            && previous.status === next.status && previous.old.kind === next.old.kind && previous.new.kind === next.new.kind
            && previous.old.revision === next.old.revision && previous.new.revision === next.new.revision;

          displayed = target;

          return equal ? previous : next;
        });
        setFailure(null);
      }
      else setFailure(result.text);
    });

    stopLoading = () => { current = false; clearTimeout(timer); };
  };

  const worktree = createMemo(() => worktrees.read(props.id));

  // U7675b: a refresh reads again only while the entry's blob has not moved on: a changed blob waits for Reload.
  createEffect(() => [worktree(), compareParams(props.id, props.path, props.to ?? "tree")] as const, ([, params]) => {
    const now = untrack(() => ({ blob: props.blob ?? null, painted: painted() }));

    if (now.painted.path === params.path && now.blob !== null && now.blob !== now.painted.blob) return;
    load(params);
  });
  onCleanup(() => stopLoading());

  createMessageToast({ get message() { return failure(); }, dismiss: () => setFailure(null), get recover() { return loading() ? undefined : { run: () => load(compareParams(props.id, props.path, props.to ?? "tree")) }; } });

  // Form/caret retention must not rebuild Pierre's DOM or disturb its selection.
  const notes = createMemo(() => props.notes.list(props.id));

  createEffect(() => {
    const value = read();
    const view = renderer();
    const annotations = notes().filter(note => value && note.comparison.oldPath === value.oldPath && note.comparison.newPath === value.newPath && note.comparison.base === value.base && note.comparison.old.revision === value.old.revision && note.comparison.new.revision === value.new.revision);

    return { view, annotations };
  }, ({ view, annotations }) => {
    view?.render({ lineAnnotations: annotations.map(note => ({ side: note.side === "old" ? "deletions" : "additions", lineNumber: note.end, metadata: note })) });
  });

  createEffect(() => {
    const value = read();
    const mount = host();

    if (!value || !mount || value.old.kind === "binary" || value.new.kind === "binary" || value.status === null || hidden() !== null) return undefined;

    return { value, mount };
  }, target => {
    if (!target) return;
    const { value, mount } = target;
    let current = true;
    let dispose: (() => void) | undefined;
    void failureOf(async () => {
      const { VirtualizedFileDiff, Virtualizer, processFile, preloadHighlighter, getFiletypeFromFileName } = await (library ??= import("@pierre/diffs").then(module => {
        // U7674d: the library ships no themes in this build; Pierre's own github-light, a Zed theme for Highlights, loads on first use.
        module.registerCustomTheme(DIFF_THEME, () => import("@pierre/highlights/themes/github-light"), "zed");

        return module;
      }));

      const { createTwoFilesPatch, structuredPatch, formatPatch } = await import("diff");

      if (!current) return;

      const oldFile = { name: value.oldPath, contents: value.old.kind === "text" ? value.old.text : "" };
      const newFile = { name: value.newPath, contents: value.new.kind === "text" ? value.new.text : "" };
      const { patch, coarse } = patchOf(oldFile, newFile, { createTwoFilesPatch, structuredPatch, formatPatch });

      setCoarse(coarse);

      // U2540's 10,000-line observer exceeded the browser bound with a full DOM; Pierre owns the visible window.
      const container = document.createElement("diffs-container");
      mount.append(container);
      const virtualizer = new Virtualizer();

      const view = new VirtualizedFileDiff<Note>({
        onLineNumberClick: ({ lineNumber, annotationSide, event }) => {
          const clickedSide = annotationSide === "deletions" ? "old" : "new";
          const old = selection();
          const range: ReturnType<typeof selection> = { side: clickedSide, start: event.shiftKey && old.side === clickedSide ? Math.min(old.start, lineNumber) : lineNumber, end: event.shiftKey && old.side === clickedSide ? Math.max(old.start, lineNumber) : lineNumber };
          setSelection(range);
          view.setSelectedLines({ side: annotationSide, start: range.start, end: range.end });
          cursor = starts.findLastIndex(each => each.side === clickedSide && each.line <= range.start);
          remember();
        },
        renderAnnotation: ({ metadata }) => { const element = document.createElement("p"); element.className = "diff-note"; element.textContent = `${copy.selectedLines(metadata.side, metadata.start === metadata.end ? `${metadata.start}` : `${metadata.start}–${metadata.end}`, metadata.start === metadata.end)}: ${metadata.text}`;

        return element; },
        theme: DIFF_THEME, lineDiffType: coarse ? "none" : "word-alt", overflow: "wrap", preferredHighlighter: "highlights", diffStyle: "unified", diffIndicators: "classic", disableFileHeader: true,  unsafeCSS: diffStyles }, virtualizer, { lineHeight: parseFloat(getComputedStyle(mount).getPropertyValue("--space-5")) || 24 });

      // U7610b: the first file opens with the list, so each step of a large rewrite yields to the page before the next.
      await new Promise(resolve => setTimeout(resolve));

      if (!current) return;

      const fileDiff = processFile(patch, { oldFile, newFile, throwOnError: true });

      if (!fileDiff) throw new Error(copy.comparisonRenderFailed);

      await new Promise(resolve => setTimeout(resolve));

      if (!current) return;

      // Pierre anchors a visible file of no height to its bottom, so a first render left waiting on the highlighter opened the diff at its last line.
      await preloadHighlighter({ themes: [DIFF_THEME], langs: [...new Set([oldFile.name, newFile.name].map(getFiletypeFromFileName))], preferredHighlighter: "highlights" });

      if (!current) return;

      // U7675d: a file opens at the scroll and line it was left at, else at its top.
      const place = props.places?.get(value.newPath);

      starts = changeStarts(patch);
      cursor = -1;
      rendered = value.newPath;
      setSelection(place?.selection ?? { side: "new", start: 1, end: 1 });
      virtualizer.setup(mount);
      view.render({ fileContainer: container, fileDiff });
      setRenderer(view);

      view.setSelectedLines({ side: selection().side === "old" ? "deletions" : "additions", start: selection().start, end: selection().end });
      mount.scrollTop = place?.scroll ?? 0;

      // U7675e: Pierre has no focus row; the focused line is its selection, and its line position scrolls it into view.
      moveTo = (side, line) => {
        setSelection({ side, start: line, end: line });
        view.setSelectedLines({ side: side === "old" ? "deletions" : "additions", start: line, end: line });
        const position = view.getLinePosition(line, side === "old" ? "deletions" : "additions");

        if (position) mount.scrollTop = position.top;
        remember();
      };
      focusHost = () => { mount.tabIndex = -1; mount.focus(); };
      const onScroll = () => remember();

      // listener-owner: removed with the rendered diff in the dispose below.
      mount.addEventListener("scroll", onScroll);
      dispose = () => {
        remember();
        mount.removeEventListener("scroll", onScroll);
        rendered = undefined;
        moveTo = () => {};
        focusHost = () => {};
        setRenderer(undefined); view.cleanUp(); virtualizer.cleanUp(); container.remove();
      };
    }).then(error => { if (current && error) setFailure(error); });

    return () => { current = false; dispose?.(); };
  });

  const remember = () => {
    const mount = host();

    if (rendered !== undefined && mount) props.places?.set(rendered, { scroll: mount.scrollTop, selection: selection() });
  };

  props.keys?.({
    focus: () => focusHost(),
    step: direction => {
      const next = starts[Math.min(Math.max(cursor + direction, 0), starts.length - 1)];

      if (!next) return;
      cursor = starts.indexOf(next);
      moveTo(next.side, next.line);
    },
  });

  const reload = () => { props.places?.forget(props.path); setShown(undefined); load(compareParams(props.id, props.path, props.to ?? "tree")); };

  return <section class="diff-reader" aria-label={copy.diff}>
    <header class="diff-header">
      <div class="diff-identity">
        <p class="diff-path"><Show when={read()} fallback={props.path}>{value => <>{value().oldPath === value().newPath ? value().newPath : copy.renamedPaths(value().oldPath, value().newPath)}</>}</Show></p>
        <Show when={read()}>{value => <Show when={value().status === "added" || value().status === "deleted"}><p class="diff-status">{value().status === "added" ? copy.statusAdded : copy.statusDeleted}</p></Show>}</Show>
      </div>
      <div class="diff-actions">
        <Show when={read()}>{value => <>
          <Show when={value().status !== null && value().old.kind !== "binary" && value().new.kind !== "binary"}><button type="button" data-button="quiet" ref={element => { addButton = element; }} onClick={() => setForm({ comparison: value(), selection: selection() })}>{copy.addNote}</button></Show>
        </>}</Show>
      </div>
    </header>
    <StatusNote text={failure() ? null : notice()} />
    <Show when={updated()}><div class="mounted-line" role="status"><span>{copy.updatedFile(props.name)}</span> <button type="button" data-button="quiet" onClick={reload}>{copy.reload}</button></div></Show>
    <Show when={hidden() === "whitespace" || hidden() === "large"}><div class="mounted-line"><button type="button" data-button="quiet" onClick={() => setShown({ path: props.path, kind: hidden() === "large" ? "large" : "whitespace" })}>{hidden() === "large" ? copy.showAnyway : copy.showWhitespace}</button></div></Show>
    <Show when={read()}>{value => <>
      <Show when={value().status !== null}>
        <Show when={value().old.kind !== "binary" && value().new.kind !== "binary"}>
          <div class="diff-content" ref={setHost} />
        </Show>
      </Show>
    </>}</Show>
    <Show when={form()} keyed>{draft => <NoteForm id={props.id} comparison={draft.comparison} notes={props.notes} selection={draft.selection} editing={draft.editing} close={closeForm} />}</Show>
    <NoteBatch fallback={() => addButton?.focus()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} comparison={read()} edit={note => setForm({ comparison: note.comparison, selection: note, editing: note })} />
  </section>;
};
