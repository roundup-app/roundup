import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, getOwner, onCleanup, runWithOwner, Show, untrack } from "solid-js";
import { render } from "@solidjs/web";
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
import { firstLine, hiddenKind, noticeFor, revisionOf, sameRead } from "./fileState";
import { annotate, drawDiff, gatheredNotes, lineAnnotations } from "./diffDraw";
import { outdated } from "./diffDraw";
import type { Annotated, Composer, Noted, Shared } from "./diffDraw";
import { createLate } from "./late";
import { NoteForm } from "./NoteForm";
import { NoteView } from "./NoteView";
import { NoteBatch } from "./NoteBatch";
import { ImagePane } from "./ImagePane";
import { drawsLines, imageHidden, imageSides } from "./images";

/** U7678c: a line's top inside the shared scroll, which holds many files: the file's own offset plus the line's place in it. */
const scrollTo = (mount: HTMLElement, top: number) => {
  const scroller = mount.closest<HTMLElement>(".module-scroll");

  if (scroller) scroller.scrollTop = mount.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + top; else mount.scrollTop = top;
};

const compareParams = (id: string, path: string, to: CompareTarget): CompareFileParams => ({ id, path, to });

/** U7675e: what the pane lets the view do from a key. */
/** U7678d: what `enter` did: moved to a change, found none in the file, or the file is not drawn yet. */
export type Entered = "moved" | "none" | "wait";

export type DiffKeys = { focus: () => void; step: (direction: 1 | -1) => boolean; enter: (direction: 1 | -1) => Entered; reload: () => void; reveal: () => void; note: () => void; edit: () => void; remove: () => void; /** U7690c: the focused line, and whether a Sent note no longer reads as it did. */ at: () => { path: string; side: "old" | "new"; line: number }; outdated: (note: Note) => boolean; /** U7678d: the file's current read, for a batch shared by a module's files. */ read: () => FileComparison | undefined };

type Slot = { element: HTMLElement; metadata: Annotated; dispose: () => void };

/** U7677: Pierre keeps what an annotation draws; the reader owns the Solid roots under it and ends those whose element Pierre dropped (it leaves the element of an annotation it no longer draws in its container, so the reader removes it with its root). */
const createSlots = () => {
  const slots = new Set<Slot>();

  const sweep = (drawn: ReadonlySet<Annotated> | undefined) => {
    for (const slot of slots) if (!drawn || !slot.element.isConnected || !drawn.has(slot.metadata)) { slot.dispose(); slot.element.parentElement?.remove(); slots.delete(slot); }
  };

  return { slots, sweep };
};

/** U7676c: the notes whose lines this file no longer shows, listed under it. */
const GatheredNotes = (props: { id: string; notes: Notes; gathered: readonly Note[]; read: FileComparison | undefined }) => <Show when={props.gathered.length}><ul class="note-group" aria-label={copy.notesNoLongerShown}>
  <For each={props.gathered}>{note => <li><Show when={outdated(note, props.read)} fallback={<><p>{copy.selectedLines(note.side, copy.lineSpan(note.start, note.end), note.start === note.end)}{copy.originalContext}</p><p class="note-text">{note.text}</p></>}><NoteView note={note} status="outdated" edit={() => {}} remove={() => void props.notes.remove(props.id, note.id)} /></Show></li>}</For>
</ul></Show>;

/** U7678d: whether a read has lines to draw: not an image, unfinished, or hidden file. */
const drawableOf = (value: FileComparison | undefined, hidden: ReturnType<typeof hiddenKind>) => value !== undefined && drawsLines(value) && value.status !== null && hidden === null;

/** U7675e, U7678d: the change starts of the drawn file and the one the focused line sits on. */
const createChangeCursor = () => {
  let starts: ChangeStart[] = [];
  let at = -1;

  return {
    set: (next: ChangeStart[], selection: LineSelection) => { starts = next; at = changeAt(starts, selection); },
    place: (selection: LineSelection) => { at = changeAt(starts, selection); },
    step: (direction: 1 | -1) => {
      const next = starts[at + direction];

      if (next) at += direction;

      return next;
    },
    enter: (direction: 1 | -1) => {
      at = direction === 1 ? 0 : starts.length - 1;

      return starts[at];
    },
  };
};

type Draft = { comparison: FileComparison; selection: LineSelection; editing?: Note };

/** U7676a, U7677e: the field a note is written in: opened from a line, a range or an edit, and closed back to the reader. */
const createNoteField = (props: { editing?: Note | undefined; onEdited: () => void }, read: () => FileComparison | undefined, refocus: () => void) => {
  const [form, setForm] = createSignal<Draft>();

  // U7677e: a Sent note is read only; Remove is all it offers.
  const edit = (note: Note | undefined) => { if (note && note.sent === undefined) setForm({ comparison: note.comparison, selection: note, editing: note }); };

  createEffect(() => props.editing, edit);

  // U7676a: a note starts from a line, a range or the focused line; the form open until then stays as unfinished work.
  const open = (range: LineSelection) => {
    const value = read();

    if (value && value.status !== null && value.old.kind !== "binary" && value.new.kind !== "binary") setForm({ comparison: value, selection: range });
  };

  // U7677d: the composer is an annotation under the last line of its range; one object per open field keeps Pierre from drawing it again.
  const composer = createMemo((): Composer | undefined => {
    const draft = form();

    return draft && { composing: true, side: draft.selection.side, start: draft.selection.start, end: draft.selection.end, replacing: draft.editing?.id };
  });

  return { form, edit, open, composer, close: () => { setForm(undefined); props.onEdited(); refocus(); } };
};

/** U7690c: a line the jump list chose, for the file that draws it. */
export type DiffTarget = { path: string; side: "old" | "new"; line: number };

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
export const DiffReader = (props: { shared?: Shared | undefined; batch?: boolean | undefined; counts?: { added: number; removed: number } | null | undefined; onFocus?: (() => void) | undefined; onDrawn?: (() => void) | undefined; id: string; name: string; path: string; blob?: string | null | undefined; places?: Places | undefined; keys?: ((keys: DiffKeys) => void) | undefined; target?: DiffTarget | undefined; arrived?: (() => void) | undefined; to?: CompareTarget | undefined; notes: Notes; editing?: Note | undefined; onEdited: () => void; recover: () => void }) => {
  const [selection, setSelection] = createSignal<LineSelection>({ side: "new", start: 1, end: 1 });
  const [focused, setFocused] = createSignal(false);
  const owner = getOwner();

  const { read, failure, setFailure, loading, slow, updated, reread } = createComparisonRead(props);
  const { form, edit, open: openNote, composer, close: closeForm } = createNoteField(props, read, () => focusHost());
  const [renderer, setRenderer] = createSignal<VirtualizedFileDiff<Annotated>>();
  const [coarse, setCoarse] = createSignal(false);
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [shown, setShown] = createSignal<{ path: string; kind: "whitespace" | "large" }>();
  const changes = createChangeCursor();
  let rendered: { path: string; revision: string } | undefined;
  let focusHost = () => {};

  let revealNearest = () => {};

  let moveTo = (_side: "old" | "new", _line: number) => {};

  const hidden = createMemo(() => hiddenKind(read(), shown()?.path === props.path ? shown()?.kind : undefined));

  const notice = createMemo(() => noticeFor({ value: read(), hidden: hidden(), loading: loading(), slow: slow(), failed: failure() !== null, coarse: coarse(), path: props.path }));

  // Form/caret retention must not rebuild Pierre's DOM or disturb its selection.
  const notes = createMemo(() => props.notes.all(props.id));

  const { slots, sweep } = createSlots();

  onCleanup(() => sweep(undefined));

  const annotation = (metadata: Annotated) => {
    const element = document.createElement("div");
    const draft = untrack(form);

    const content = () => {
      if ("unfinished" in metadata) return <button type="button" class="diff-note" onClick={() => openNote({ side: metadata.side, start: metadata.start, end: metadata.end })}>{copy.unfinishedWork}</button>;

      if ("composing" in metadata) return draft ? <NoteForm id={props.id} comparison={draft.comparison} notes={props.notes} selection={draft.selection} editing={draft.editing} close={closeForm} focus={setFocused} /> : undefined;

      return <NoteView note={metadata} status={metadata.sent !== undefined ? "sent" : props.notes.noteState(props.id, metadata)} edit={() => edit(metadata)} remove={() => void props.notes.remove(props.id, metadata.id)} />;
    };

    slots.add({ element, metadata, dispose: runWithOwner(owner, () => render(content, element, undefined, { owner })) ?? (() => {}) });

    return element;
  };

  let mark = (_ranges: readonly Noted[]) => {};

  createEffect(() => ({ view: renderer(), lines: lineAnnotations(read(), notes(), composer() ? [] : props.notes.unfinished(props.id), composer()), active: focused() }), ({ view, lines, active }) => {
    if (!view) return;
    annotate(view, lines, untrack(selection));
    sweep(new Set(lines.map(line => line.metadata)));
    mark(lines.flatMap(({ metadata }) => "unfinished" in metadata ? [] : [{ side: metadata.side, start: metadata.start, end: metadata.end, focused: "composing" in metadata && active }]));
  });

  // U7678d: a file with nothing to draw is settled once its read is.
  createEffect(() => !loading() && !drawableOf(read(), hidden()), settled => { if (settled) props.onDrawn?.(); });

  createEffect(() => {
    const value = read();
    const mount = host();

    if (!value || !mount || !drawableOf(value, hidden())) return undefined;

    return { value, mount };
  }, target => {
    if (!target) return;
    const { value, mount } = target;
    const { shared, onFocus } = props;
    let current = true;
    let dispose: (() => void) | undefined;
    void failureOf(async () => {
      const drawn = await drawDiff(value, mount, { current: () => current, shared, selection, pick: range => { setSelection(range); changes.place(range); onFocus?.(); remember(); }, note: range => openNote(range), annotation });

      if (!drawn) return;
      const { view, virtualizer, container, fileDiff, coarse } = drawn;

      mark = drawn.mark;

      setCoarse(coarse);

      // U7675d: a file opens at the scroll and line it was left at, else at its top; a comparison that changed starts at its top.
      const revision = revisionOf(value);
      const place = placeOf(props.places, value.newPath, revision, firstLine(value));

      const kept = props.places?.get(value.newPath);
      const restarted = shared !== undefined && kept !== undefined && kept.revision !== revision;

      changes.set(changeStarts(fileDiff), place.selection);
      rendered = { path: value.newPath, revision };
      setSelection(place.selection);

      if (!shared) virtualizer.setup(mount);
      view.render({ fileContainer: container, fileDiff });
      setRenderer(view);

      view.setSelectedLines({ side: sideName(selection().side), start: selection().start, end: selection().end });
      queueMicrotask(() => props.onDrawn?.());

      if (!shared) mount.scrollTop = place.scroll;

      // A comparison that changed starts at its file's top in the shared scroll too.
      if (restarted && shared?.scroller) shared.scroller.scrollTop = mount.closest<HTMLElement>(".module-file")?.offsetTop ?? 0;

      // U7675e: Pierre has no focus row; the focused line is its selection, and its line position scrolls it into view.
      moveTo = (side, line) => {
        setSelection({ side, start: line, end: line });
        view.setSelectedLines({ side: sideName(side), start: line, end: line });
        const position = view.getLinePosition(line, sideName(side));

        if (position) scrollTo(mount, position.top);
        onFocus?.();
        remember();
      };

      focusHost = () => { mount.tabIndex = -1; mount.focus(); };

      // U7692b: V opens the fold nearest the focused line by the click's step.
      revealNearest = revealerOf(view, fileDiff, selection);

      // listener-owner: removed with the rendered diff in the dispose below.
      if (!shared) mount.addEventListener("scroll", remember);
      dispose = () => {
        remember();
        mount.removeEventListener("scroll", remember);
        rendered = undefined;
        moveTo = () => {};

        focusHost = () => {};

        revealNearest = () => {};

        mark = () => {};

        setRenderer(undefined); view.cleanUp();

        if (!shared) virtualizer.cleanUp();
        container.remove();
      };
    }).then(error => { if (current && error) setFailure(error); });

    return () => { current = false; dispose?.(); };
  });

  const remember = () => {
    const mount = host();

    if (rendered !== undefined && mount) props.places?.set(rendered.path, { revision: rendered.revision, scroll: props.shared ? 0 : mount.scrollTop, selection: selection() });
  };

  // U7690c: the line a note's jump chose takes the focus once its file is drawn.
  createEffect(() => ({ view: renderer(), target: props.target }), ({ view, target }) => {
    if (!view || !target || rendered?.path !== target.path) return;
    moveTo(target.side, target.line);
    focusHost();
    props.arrived?.();
  });

  createEffect(() => props.keys, keys => keys?.({
    at: () => ({ path: props.path, side: selection().side, line: selection().start }), outdated: note => outdated(note, read()), read: () => read(),
    focus: () => focusHost(), reload: () => reload(), reveal: () => revealNearest(), note: () => openNote(selection()), edit: () => edit(noteOnLine()),
    remove: () => { const note = noteOnLine();

      if (note) void props.notes.remove(props.id, note.id);
    },
    step: direction => {
      const next = changes.step(direction);

      if (!next) return false;
      moveTo(next.side, next.at[next.side]);

      return true;
    },
    enter: direction => {
      const next = changes.enter(direction);

      if (!next) return loading() || (drawableOf(read(), hidden()) && rendered === undefined) ? "wait" : "none";
      moveTo(next.side, next.at[next.side]);

      return "moved";
    },
  }));

  // U7676c: a note whose comparison is not the open one stays in the batch and gathers after the file's last line.
  const gathered = createMemo(() => gatheredNotes(read(), notes()));

  const noteOnLine = () => {
    const at = selection();

    return notes().find(note => note.side === at.side && note.start <= at.start && at.start <= note.end && note.comparison.newPath === props.path);
  };

  const reload = () => { setShown(undefined); reread(); };

  return <section class="diff-reader" aria-label={copy.diff}>
    <header class="diff-header">
      <DiffIdentity read={read()} path={props.path} />
      <Show when={props.counts}>{counts => <p class="diff-counts">{copy.addedLines(counts().added)} {copy.removedLines(counts().removed)}</p>}</Show>
    </header>
    <StatusNote text={failure() ? null : notice()} />
    <Show when={updated()}><div class="mounted-line" role="status"><span>{copy.updatedFile(props.name)}</span> <button type="button" data-button="quiet" onClick={reload}>{copy.reload}</button></div></Show>
    <Show when={hidden() === "whitespace" || hidden() === "large"}><div class="mounted-line"><button type="button" data-button="quiet" onClick={() => setShown({ path: props.path, kind: hidden() === "large" ? "large" : "whitespace" })}>{hidden() === "large" ? copy.showAnyway : copy.showWhitespace}</button></div></Show>
    <Show when={read()}>{value => <Show when={value().status !== null && drawsLines(value())}><div class="diff-content" tabindex="-1" ref={setHost} /></Show>}</Show>
    <Show when={read()}>{value => <Show when={value().status !== null && imageHidden(value()) === null ? imageSides(value()) : null} keyed>{sides => <ImagePane sides={sides} />}</Show>}</Show>
    <GatheredNotes id={props.id} notes={props.notes} gathered={gathered()} read={read()} />
    <Show when={props.batch !== false}><NoteBatch fallback={() => focusHost()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} comparison={read()} edit={edit} /></Show>
  </section>;
};
