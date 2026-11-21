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
import { changeAt, changeStarts, placeOf, revealerOf, sideName } from "./lines";
import type { ChangeStart, LineSelection, Places } from "./lines";
import type { Note, Notes } from "./notes";
import { firstLine, hiddenKind, noticeFor, revisionOf, sameRead, sameRevisions } from "./fileState";
import { drawDiff } from "./diffDraw";
import { createLate } from "./late";
import { NoteForm } from "./NoteForm";
import { NoteBatch } from "./NoteBatch";
import { ImagePane } from "./ImagePane";
import { drawsLines, imageHidden, imageSides } from "./images";

const compareParams = (id: string, path: string, to: CompareTarget): CompareFileParams => ({ id, path, to });

/** U7675e: what the pane lets the view do from a key. */
export type DiffKeys = { focus: () => void; step: (direction: 1 | -1) => void; reload: () => void; reveal: () => void };

const DiffIdentity = (props: { read: FileComparison | undefined; path: string }) => <div class="diff-identity">
  <p class="diff-path"><Show when={props.read} fallback={props.path}>{value => <>{value().oldPath === value().newPath ? value().newPath : copy.renamedPaths(value().oldPath, value().newPath)}</>}</Show></p>
  <Show when={props.read}>{value => <Show when={value().status === "added" || value().status === "deleted"}><p class="diff-status">{value().status === "added" ? copy.statusAdded : copy.statusDeleted}</p></Show>}</Show>
</div>;

type ReadProps = { id: string; path: string; blob?: string | null | undefined; to?: CompareTarget | undefined };

/** U7675b: one file's comparison read: its value, failure and wait, and the read again that Reload asks for. */
const createComparisonRead = (props: ReadProps) => {
  const { app, worktrees } = useConnectedProject();
  const [read, setRead] = createSignal<FileComparison>();
  const [failure, setFailure] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [painted, setPainted] = createSignal<{ path: string; blob: string | null }>(untrack(() => ({ path: props.path, blob: props.blob ?? null })));
  let displayed: { id: string; path: string } | undefined;
  let stopLoading = () => {};

  // U7675b: a read of a file whose entry's blob moved on says so and waits for Reload.
  const updated = () => !loading() && painted().path === props.path && painted().blob !== (props.blob ?? null);

  // Each read starts its own 150 ms: switching files while one is pending names the new file only after its own wait.
  const slow = createLate(() => loading() ? props.path : undefined);

  // U7692a: Reload draws a fresh reader even when the file reads the same, so its folds close again.
  let redraw = false;

  const load = (params: CompareFileParams) => {
    stopLoading();
    setLoading(true);
    setPainted({ path: params.path, blob: untrack(() => props.blob) ?? null });
    const target = { id: params.id, path: params.path };
    let current = true;
    void reply(() => app.rpc("agent.compareFile", params)).then(result => {
      if (!current) return;

      setLoading(false);

      if (result.kind === "ok") {
        const same = displayed?.id === target.id && displayed.path === target.path;

        displayed = target;
        const again = redraw;

        redraw = false;
        setRead(previous => same && !again && previous && sameRead(previous, result.value) ? previous : result.value);
        setFailure(null);
      }
      else setFailure(result.text);
    });

    stopLoading = () => { current = false; };
  };

  const params = () => compareParams(props.id, props.path, props.to ?? "tree");

  const worktree = createMemo(() => worktrees.read(props.id));

  // U7675b: a refresh reads again only while the entry's blob has not moved on: a changed blob waits for Reload.
  createEffect(() => [worktree(), params()] as const, ([, next]) => {
    const now = untrack(() => ({ blob: props.blob ?? null, painted: painted() }));

    if (now.painted.path === next.path && now.blob !== null && now.blob !== now.painted.blob) return;
    load(next);
  });
  onCleanup(() => stopLoading());

  createMessageToast({ get message() { return failure(); }, dismiss: () => setFailure(null), get recover() { return loading() ? undefined : { run: () => load(params()) }; } });

  return { read, failure, setFailure, loading, slow, updated, reread: () => { redraw = true; load(params()); } };
};

/** One read-only comparison, fetched only after View diff. */
export const DiffReader = (props: { id: string; name: string; path: string; blob?: string | null | undefined; places?: Places | undefined; keys?: ((keys: DiffKeys) => void) | undefined; to?: CompareTarget | undefined; notes: Notes; editing?: Note | undefined; onEdited: () => void; recover: () => void }) => {
  const [selection, setSelection] = createSignal<LineSelection>({ side: "new", start: 1, end: 1 });
  const [form, setForm] = createSignal<{ comparison: FileComparison; selection: LineSelection; editing?: Note }>();

  createEffect(() => props.editing, note => {
    if (note) setForm({ comparison: note.comparison, selection: note, editing: note });
  });

  let addButton: HTMLButtonElement | undefined;
  const closeForm = () => { setForm(undefined); props.onEdited(); addButton?.focus(); };

  const { read, failure, setFailure, loading, slow, updated, reread } = createComparisonRead(props);
  const [renderer, setRenderer] = createSignal<VirtualizedFileDiff<Note>>();
  const [coarse, setCoarse] = createSignal(false);
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [shown, setShown] = createSignal<{ path: string; kind: "whitespace" | "large" }>();
  let starts: ChangeStart[] = [];
  let cursor = -1;
  let rendered: { path: string; revision: string } | undefined;
  let focusHost = () => {};

  let revealNearest = () => {};

  let moveTo = (_side: "old" | "new", _line: number) => {};

  const hidden = createMemo(() => hiddenKind(read(), shown()?.path === props.path ? shown()?.kind : undefined));

  const notice = createMemo(() => noticeFor({ value: read(), hidden: hidden(), loading: loading(), slow: slow(), failed: failure() !== null, coarse: coarse(), selection: selection(), path: props.path }));

  // Form/caret retention must not rebuild Pierre's DOM or disturb its selection.
  const notes = createMemo(() => props.notes.list(props.id));

  createEffect(() => {
    const value = read();
    const view = renderer();
    const annotations = notes().filter(note => value && sameRevisions(note.comparison, value));

    return { view, annotations };
  }, ({ view, annotations }) => {
    view?.render({ lineAnnotations: annotations.map(note => ({ side: note.side === "old" ? "deletions" : "additions", lineNumber: note.end, metadata: note })) });

    // U7692b: a note's line is never hidden in a fold; an unchanged line is a new-side line.
    for (const note of annotations) if (note.side === "new") { view?.revealLine(note.start); view?.revealLine(note.end); }
  });

  createEffect(() => {
    const value = read();
    const mount = host();

    if (!value || !mount || !drawsLines(value) || value.status === null || hidden() !== null) return undefined;

    return { value, mount };
  }, target => {
    if (!target) return;
    const { value, mount } = target;
    let current = true;
    let dispose: (() => void) | undefined;
    void failureOf(async () => {
      const drawn = await drawDiff(value, mount, { current: () => current, selection, pick: range => { setSelection(range); cursor = changeAt(starts, range); remember(); } });

      if (!drawn) return;
      const { view, virtualizer, container, fileDiff, coarse } = drawn;

      setCoarse(coarse);

      // U7675d: a file opens at the scroll and line it was left at, else at its top; a comparison that changed starts at its top.
      const revision = revisionOf(value);
      const place = placeOf(props.places, value.newPath, revision, firstLine(value));

      starts = changeStarts(fileDiff);
      cursor = changeAt(starts, place.selection);
      rendered = { path: value.newPath, revision };
      setSelection(place.selection);
      virtualizer.setup(mount);
      view.render({ fileContainer: container, fileDiff });
      setRenderer(view);

      view.setSelectedLines({ side: sideName(selection().side), start: selection().start, end: selection().end });
      mount.scrollTop = place.scroll;

      // U7675e: Pierre has no focus row; the focused line is its selection, and its line position scrolls it into view.
      moveTo = (side, line) => {
        setSelection({ side, start: line, end: line });
        view.setSelectedLines({ side: sideName(side), start: line, end: line });
        const position = view.getLinePosition(line, sideName(side));

        if (position) mount.scrollTop = position.top;
        remember();
      };

      focusHost = () => { mount.tabIndex = -1; mount.focus(); };

      // U7692b: V opens the fold nearest the focused line by the click's step.
      revealNearest = revealerOf(view, fileDiff, selection);

      // listener-owner: removed with the rendered diff in the dispose below.
      mount.addEventListener("scroll", remember);
      dispose = () => {
        remember();
        mount.removeEventListener("scroll", remember);
        rendered = undefined;
        moveTo = () => {};

        focusHost = () => {};

        revealNearest = () => {};

        setRenderer(undefined); view.cleanUp(); virtualizer.cleanUp(); container.remove();
      };
    }).then(error => { if (current && error) setFailure(error); });

    return () => { current = false; dispose?.(); };
  });

  const remember = () => {
    const mount = host();

    if (rendered !== undefined && mount) props.places?.set(rendered.path, { revision: rendered.revision, scroll: mount.scrollTop, selection: selection() });
  };

  createEffect(() => props.keys, keys => keys?.({
    focus: () => focusHost(), reload: () => reload(), reveal: () => revealNearest(),
    step: direction => {
      const next = starts[Math.min(Math.max(cursor + direction, 0), starts.length - 1)];

      if (!next) return;
      cursor = starts.indexOf(next);
      moveTo(next.side, next.at[next.side]);
    },
  }));

  const reload = () => { setShown(undefined); reread(); };

  return <section class="diff-reader" aria-label={copy.diff}>
    <header class="diff-header">
      <DiffIdentity read={read()} path={props.path} />
      <div class="diff-actions">
        <Show when={read()}>{value => <>
          <Show when={value().status !== null && drawsLines(value())}><button type="button" data-button="quiet" ref={element => { addButton = element; }} onClick={() => setForm({ comparison: value(), selection: selection() })}>{copy.addNote}</button></Show>
        </>}</Show>
      </div>
    </header>
    <StatusNote text={failure() ? null : notice()} />
    <Show when={updated()}><div class="mounted-line" role="status"><span>{copy.updatedFile(props.name)}</span> <button type="button" data-button="quiet" onClick={reload}>{copy.reload}</button></div></Show>
    <Show when={hidden() === "whitespace" || hidden() === "large"}><div class="mounted-line"><button type="button" data-button="quiet" onClick={() => setShown({ path: props.path, kind: hidden() === "large" ? "large" : "whitespace" })}>{hidden() === "large" ? copy.showAnyway : copy.showWhitespace}</button></div></Show>
    <Show when={read()}>{value => <Show when={value().status !== null && drawsLines(value())}><div class="diff-content" ref={setHost} /></Show>}</Show>
    <Show when={read()}>{value => <Show when={value().status !== null && imageHidden(value()) === null ? imageSides(value()) : null} keyed>{sides => <ImagePane sides={sides} />}</Show>}</Show>
    <Show when={form()} keyed>{draft => <NoteForm id={props.id} comparison={draft.comparison} notes={props.notes} selection={draft.selection} editing={draft.editing} close={closeForm} />}</Show>
    <NoteBatch fallback={() => addButton?.focus()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} comparison={read()} edit={note => setForm({ comparison: note.comparison, selection: note, editing: note })} />
  </section>;
};
