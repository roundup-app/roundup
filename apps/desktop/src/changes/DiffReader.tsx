import { ExitButton } from "../ui/IconButton";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, onCleanup, on, Show } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { useConnectedProject } from "../state/connectedProject";
import { ReservedLine } from "../ink/ReservedLine";
import { failureOf } from "../todos/failureOf";
import { reply } from "./notes";
import type { Note, Notes } from "./notes";
import { NoteForm } from "./NoteForm";
import { NoteBatch } from "./NoteBatch";
import diffStyles from "./diff.styles.css?inline";

let library: Promise<typeof import("@pierre/diffs")> | undefined;

/** U2540d: startup and Agent selection never fetch the renderer. */
export const diffsLoaded = () => library !== undefined;

/** One read-only comparison, fetched only after View diff. */
export const DiffReader = (props: { id: string; name: string; path: string; notes: Notes; editing?: Note | undefined; onEdited: () => void; onBack: () => void; onClose: () => void; recover: () => void }) => {
  const { app, worktrees } = useConnectedProject();
  const [selection, setSelection] = createSignal<{ side: "old" | "new"; start: number; end: number }>({ side: "new", start: 1, end: 1 });
  const [form, setForm] = createSignal<{ comparison: FileComparison; selection: ReturnType<typeof selection>; editing?: Note }>();

  createEffect(() => {
    const note = props.editing;

    if (note) setForm({ comparison: note.comparison, selection: note, editing: note });
  });

  let addButton: HTMLButtonElement | undefined;
  let backButton: HTMLButtonElement | undefined;
  const closeForm = () => { setForm(undefined); props.onEdited(); (addButton ?? backButton)?.focus(); };

  const [read, setRead] = createSignal<FileComparison>();
  const [failure, setFailure] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [version, setVersion] = createSignal(0);
  const [coarse, setCoarse] = createSignal(false);
  const [host, setHost] = createSignal<HTMLDivElement>();

  const notice = createMemo(() => {
    const value = read();

    if (!value) return loading() ? (failure() ? null : copy.loadingDiff) : failure() ? null : copy.diffNotLoaded;

    if (value.status === null) return copy.noDifference;

    if (value.old.kind === "binary" || value.new.kind === "binary") return copy.binaryDiff;

    return coarse() ? copy.replacementDiff : copy.selectedLines(selection().side, selection().start === selection().end ? `${selection().start}` : `${selection().start}–${selection().end}`, selection().start === selection().end);
  });

  const worktree = createMemo(() => worktrees.read(props.id));

  createEffect(on(() => [version(), worktree(), props.id, props.path], () => {
    setLoading(true);
    setCoarse(false);
    let current = true;
    void reply(() => app.rpc("agent.compareFile", { id: props.id, path: props.path })).then(result => {
      if (!current) return;

      setLoading(false);

      if (result.kind === "ok") { setRead(result.value); setFailure(null); }
      else setFailure(result.text);
    });
    onCleanup(() => { current = false; });
  }));

  // Form/caret retention must not rebuild Pierre's DOM or disturb its selection.
  const notes = createMemo(() => props.notes.list(props.id));

  createEffect(() => {
    const value = read();
    const mount = host();
    const annotations = notes().filter(note => value && note.comparison.oldPath === value.oldPath && note.comparison.newPath === value.newPath && note.comparison.base === value.base && note.comparison.old.revision === value.old.revision && note.comparison.new.revision === value.new.revision);

    if (!value || !mount || value.old.kind === "binary" || value.new.kind === "binary" || value.status === null) return;
    let current = true;
    let dispose: (() => void) | undefined;
    void failureOf(async () => {
      const { VirtualizedFileDiff, Virtualizer, processFile } = await (library ??= import("@pierre/diffs").then(module => {
        module.registerCustomCSSVariableTheme("roundup", {});

        return module;
      }));

      const { createTwoFilesPatch, structuredPatch, formatPatch } = await import("diff");

      if (!current) return;

      // U2540's 10,000-line observer exceeded the browser bound with a full DOM; Pierre owns the visible window.
      const container = document.createElement("diffs-container");
      mount.append(container);
      const virtualizer = new Virtualizer();

      const view = new VirtualizedFileDiff<Note>({
        onLineNumberClick: ({ lineNumber, annotationSide, event }) => {
          const clickedSide = annotationSide === "deletions" ? "old" : "new";
          const old = selection();
          setSelection({ side: clickedSide, start: event.shiftKey && old.side === clickedSide ? Math.min(old.start, lineNumber) : lineNumber, end: event.shiftKey && old.side === clickedSide ? Math.max(old.start, lineNumber) : lineNumber });
          const range = selection();
          view.setSelectedLines({ side: annotationSide, start: range.start, end: range.end });
        },
        renderAnnotation: ({ metadata }) => { const element = document.createElement("p"); element.className = "diff-note"; element.textContent = `${copy.selectedLines(metadata.side, metadata.start === metadata.end ? `${metadata.start}` : `${metadata.start}–${metadata.end}`, metadata.start === metadata.end)}: ${metadata.text}`;

        return element; },
        theme: "roundup", preferredHighlighter: "highlights", diffStyle: "unified", diffIndicators: "classic", disableFileHeader: true,  unsafeCSS: diffStyles }, virtualizer, { lineHeight: parseFloat(getComputedStyle(mount).getPropertyValue("--space-5")) || 24 });

      const oldFile = { name: value.oldPath, contents: value.old.kind === "text" ? value.old.text : "" };
      const newFile = { name: value.newPath, contents: value.new.kind === "text" ? value.new.text : "" };
      // U2540’s 10,000-line complete rewrite froze the rendered observer beyond 30 seconds.
      // jsdiff bounds that search; its empty-side patches supply a lossless coarse fallback.
      let patch = createTwoFilesPatch(oldFile.name, newFile.name, oldFile.contents, newFile.contents, undefined, undefined, { timeout: 100, maxEditLength: 2000 });

      setCoarse(patch === undefined);

      if (patch === undefined) {
        const removed = structuredPatch(oldFile.name, newFile.name, oldFile.contents, "");
        const added = structuredPatch(oldFile.name, newFile.name, "", newFile.contents);
        const before = removed.hunks[0];
        const after = added.hunks[0];

        patch = formatPatch({ ...removed, hunks: [{
          oldStart: before?.oldStart ?? 0, oldLines: before?.oldLines ?? 0,
          newStart: after?.newStart ?? 0, newLines: after?.newLines ?? 0,
          lines: [...(before?.lines ?? []), ...(after?.lines ?? [])],
        }] });
      }

      const fileDiff = processFile(patch, { oldFile, newFile, throwOnError: true });

      if (!fileDiff) throw new Error(copy.comparisonRenderFailed);

      virtualizer.setup(mount);
      view.render({ lineAnnotations: annotations.map(note => ({ side: note.side === "old" ? "deletions" : "additions", lineNumber: note.end, metadata: note })), fileContainer: container, fileDiff });

      // The initial empty viewport gives Pierre a bottom anchor; reset after its first layout.
      const initialLayout = new ResizeObserver(() => {
        if (!current || mount.clientHeight === 0) return;
        initialLayout.disconnect();
        virtualizer.scrollTo({ top: 0 });
      });

      initialLayout.observe(mount);
      view.setSelectedLines({ side: selection().side === "old" ? "deletions" : "additions", start: selection().start, end: selection().end });
      dispose = () => { initialLayout.disconnect(); view.cleanUp(); virtualizer.cleanUp(); container.remove(); };
    }).then(error => { if (current && error) setFailure(error); });
    onCleanup(() => { current = false; dispose?.(); });
  });

  return <section class="diff-reader" aria-label={copy.diff}>
    <header class="diff-header">
      <div class="diff-identity">
        <p class="diff-path"><Show when={read()} fallback={props.path}>{value => value().oldPath === value().newPath ? value().newPath : `${value().oldPath} → ${value().newPath}`}</Show></p>
      </div>
      <div class="diff-actions">
        <Show when={read()}>{value => <>
          <Show when={value().status !== null && value().old.kind !== "binary" && value().new.kind !== "binary"}><button type="button" data-button="quiet" ref={element => { addButton = element; }} onClick={() => setForm({ comparison: value(), selection: selection() })}>{copy.addNote}</button></Show>
        </>}</Show>
        <ExitButton ref={element => { backButton = element; }} onClick={props.onBack} />
        <button type="button" data-button="quiet" onClick={props.onClose}>{copy.closeChanges}</button>
      </div>
    </header>
    <ReservedLine message={failure()} status={notice()}><Show when={!loading() && failure()}><button type="button" data-button="quiet" onClick={() => setVersion(v => v + 1)}>{copy.retry}</button></Show><Show when={failure()}><button type="button" data-button="quiet" onClick={() => setFailure(null)}>{copy.dismissFailure}</button></Show></ReservedLine>
    <Show when={read()}>{value => <>
      <Show when={value().status !== null}>
        <Show when={value().old.kind !== "binary" && value().new.kind !== "binary"}>
          <div class="diff-content" ref={setHost} />
        </Show>
      </Show>
    </>}</Show>
    <Show when={form()} keyed>{draft => <NoteForm id={props.id} comparison={draft.comparison} notes={props.notes} selection={draft.selection} editing={draft.editing} close={closeForm} />}</Show>
    <NoteBatch fallback={() => backButton?.focus()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} comparison={read()} edit={note => setForm({ comparison: note.comparison, selection: note, editing: note })} />
  </section>;
};
