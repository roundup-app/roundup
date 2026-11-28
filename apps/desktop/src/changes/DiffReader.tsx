import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, getOwner, onCleanup, runWithOwner, Show, untrack } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import type { VirtualizedFileDiff } from "@pierre/diffs";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Gap } from "@contracts/agent/Gap";
import type { LineSpan } from "@contracts/agent/LineSpan";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import type { CompareFileParams } from "@contracts/agent/CompareFileParams";
import type { OwnedGroupKey } from "@contracts/agent/OwnedGroupKey";
import type { ChangedStatus } from "@contracts/agent/ChangedStatus";
import { useConnectedProject } from "../state/connectedProject";
import { BlockedFailure, StatusNote } from "../ink/MountedLine";
import { failureOf } from "../app/failureOf";
import { reply } from "./notes";
import { isNew, statusText } from "./paths";
import { changeAt, changeStarts, placeOf, revealerOf, sideName } from "./lines";
import type { ChangeStart, LineSelection, Places } from "./lines";
import type { Takes } from "./modules";
import { isLine } from "./notes";
import type { LineNote, Notes } from "./notes";
import { compareParams, firstLine, hiddenKind, noticeFor, revisionOf, sameRead } from "./fileState";
import { annotate, drawDiff, gatheredNotes, lineAnnotations, renderedApart } from "./diffDraw";
import { outdated } from "./diffDraw";
import { isMark } from "./diffDraw";
import type { Annotated, Composer, Shared, Stamped } from "./diffDraw";
import { LineMark } from "./LineMark";
import { createExplaining } from "./explain";
import type { Explanations } from "./explain";
import { createFinding, type FindingsState } from "./findings";
import type { ExplainForm } from "@contracts/agent/ExplainForm";
import { createGapped, createMoving } from "./repeats";
import { createSpotted, undrawn } from "./spots";
import { SpotList } from "./SpotLine";
import type { Moved } from "./moves";
import type { Spot } from "@contracts/agent/Spot";
import { createLate } from "./late";
import { NoteForm } from "./NoteForm";
import { NoteView, acceptedAs } from "./NoteView";
import { NoteBatch, type DiffTarget } from "./NoteBatch";
import { ImagePane } from "./ImagePane";
import { drawsLines, imageHidden, imageSides } from "./images";

/** U7678c: a line's top inside the shared scroll, which holds many files: the file's own offset plus the line's place in it. */
const scrollTo = (mount: HTMLElement, top: number) => {
  const scroller = mount.closest<HTMLElement>(".module-scroll");

  if (scroller) scroller.scrollTop = mount.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + top; else mount.scrollTop = top;
};

/** U7675e: what the pane lets the view do from a key. */
/** U7678d: what `enter` did: moved to a change, found none in the file, or the file is not drawn yet. */
export type Entered = "moved" | "none" | "wait";

export type DiffKeys = { focus: () => void; step: (direction: 1 | -1) => boolean; enter: (direction: 1 | -1) => Entered; reload: () => void; reveal: () => void; note: () => void; /** U7698a: W and D ask the readback's reader to explain the selected lines. */ explain: (form: ExplainForm) => void; edit: () => void; remove: () => void; /** U7690c: the focused line, and whether a Sent note no longer reads as it did. */ at: () => { path: string; side: "old" | "new"; line: number }; outdated: (note: LineNote) => boolean; /** U7678d: the file's current read, for a batch shared by a module's files. */ read: () => FileComparison | undefined };

type Slot = { element: HTMLElement; metadata: Annotated; dispose: () => void };

/** U7677: Pierre keeps what an annotation draws; the reader owns the Solid roots under it and ends those whose element Pierre dropped (it leaves the element of an annotation it no longer draws in its container, so the reader removes it with its root). */
const createSlots = () => {
  const slots = new Set<Slot>();

  const sweep = (drawn: ReadonlySet<Annotated> | undefined) => {
    for (const slot of slots) if (!drawn || !slot.element.isConnected || !drawn.has(slot.metadata)) { slot.dispose(); slot.element.parentElement?.remove(); slots.delete(slot); }
  };

  return { slots, sweep };
};

/** U7676c, U7704e: what no line of this file shows, listed under it: the notes whose lines it no longer shows, then the spots. */
const Unshown = (props: { id: string; notes: Notes; gathered: readonly LineNote[]; read: FileComparison | undefined; spots: readonly Spot[]; drawable: boolean; only: Takes | undefined }) => <><Show when={props.gathered.length}><ul class="note-group" aria-label={copy.notesNoLongerShown}>
  <For each={props.gathered}>{note => <li><Show when={outdated(note, props.read)} fallback={<><p>{copy.selectedLines(note.side, copy.lineSpan(note.start, note.end), note.start === note.end)}{copy.originalContext}</p><p class="note-text">{note.text}</p></>}><NoteView note={note} status="outdated" edit={() => {}} remove={() => void props.notes.remove(props.id, note.id)} /></Show></li>}</For>
</ul></Show><SpotList spots={undrawn(props.spots, props.read, props.drawable, props.only)} /></>;

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
    /** U7695c: the first change that begins in `span` on `side`, where `]` would stop on it. */
    within: (side: "old" | "new", span: LineSpan) => starts.find(each => span.start <= each.at[side] && each.at[side] <= span.end),
    enter: (direction: 1 | -1) => {
      at = direction === 1 ? 0 : starts.length - 1;

      return starts[at];
    },
  };
};

type Draft = { comparison: FileComparison; selection: LineSelection; editing?: LineNote };

/** U7676a, U7677e: the field a note is written in: opened from a line, a range or an edit, and closed back to the reader. */
const createNoteField = (props: { editing?: LineNote | undefined; onEdited: () => void }, read: () => FileComparison | undefined, refocus: () => void) => {
  const [form, setForm] = createSignal<Draft>();

  // U7677e: a Sent note is read only; Remove is all it offers.
  const edit = (note: LineNote | undefined) => { if (note && note.sent === undefined) setForm({ comparison: note.comparison, selection: note, editing: note }); };

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

/** U7854d: the word a diff header carries: New for a created file, Deleted for a removed one, none for the rest. */
const statusWord = (status: ChangedStatus | null) => status !== null && (isNew(status) || status === "deleted") ? statusText[status] : null;

/** U7697a: the rank word, while the readback's order is in force, sits in the header with the path and the status word. */
export const DiffIdentity = (props: { read: FileComparison | undefined; path: string; rank?: string | undefined }) => <div class="diff-identity">
  <p class="diff-path"><Show when={props.read} fallback={props.path}>{value => <>{value().oldPath === value().newPath ? value().newPath : copy.renamedPaths(value().oldPath, value().newPath)}</>}</Show></p>
  <Show when={props.read && statusWord(props.read.status)}>{word => <p class="diff-status">{word()}</p>}</Show>
  <Show when={props.rank}>{word => <p class="diff-rank">{word()}</p>}</Show>
</div>;

/** U7696a: `onRead` hears each file this reader reads, for the Logic lens's moves. */
type ReadProps = { /** U8031c: a waiting reader draws its bar and reads nothing until released. */ waiting?: boolean | undefined; id: string; path: string; blob?: string | null | undefined; to?: CompareTarget | undefined; group?: OwnedGroupKey | undefined; onRead?: ((value: FileComparison) => void) | undefined };

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
  const slow = createLate(() => loading() && !props.waiting ? props.path : undefined);

  // U7692a: Reload draws a fresh reader even when the file reads the same, so its folds close again.
  let redraw = false;

  const load = (params: CompareFileParams) => {
    if (untrack(() => props.waiting)) return;
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

  const waiting = createMemo(() => props.waiting === true);

  const params = () => compareParams(props.id, props.path, props.to ?? "tree", props.group);

  const worktree = createMemo(() => worktrees.read(props.id));

  // U7675b: a refresh reads again only while the entry's blob has not moved on: a changed blob waits for Reload.
  createEffect(() => [worktree(), params(), waiting()] as const, ([, next]) => {
    const now = untrack(() => ({ blob: props.blob ?? null, painted: painted() }));

    if (now.painted.path === next.path && now.blob !== null && now.blob !== now.painted.blob) return;
    load(next);
  });
  onCleanup(() => stopLoading());

  createEffect(read, value => { if (value) props.onRead?.(value); });

  return { read, failure, setFailure, loading, slow, updated, retry: () => load(params()), reread: () => { redraw = true; load(params()); } };
};

/** One read-only comparison, fetched only after View diff. */
export const DiffReader = (props: { waiting?: boolean | undefined; shared?: Shared | undefined; batch?: boolean | undefined; counts?: { added: number; removed: number } | null | undefined; onFocus?: (() => void) | undefined; onDrawn?: (() => void) | undefined; id: string; name: string; path: string; blob?: string | null | undefined; places?: Places | undefined; keys?: ((keys: DiffKeys) => void) | undefined; target?: DiffTarget | undefined; arrived?: (() => void) | undefined; only?: Takes | undefined; /** U7704a: the spots of this file, and the editor's open for the place a mark shows. */ spots?: readonly Spot[] | undefined; /** U7688e: the gaps whose line this file shows. */ gaps?: readonly Gap[] | undefined; /** U7696a: the moves and renames in this file's new lines, and the Logic lens's ask for a file once it is drawn. */ moves?: readonly Moved[] | undefined; onRead?: ((value: FileComparison) => void) | undefined; openAt?: ((path: string, at: { side: "new"; line: number }) => void) | undefined; to?: CompareTarget | undefined; group?: OwnedGroupKey | undefined; notes: Notes; editing?: LineNote | undefined; onEdited: () => void; recover: () => void; /** U7691a: the file's note icon, and the file notes its form and list draw under the header. */ onNote?: ((opener: Element) => void) | undefined; under?: JSX.Element; /** U7697a: the word of this file's rank. */ rank?: string | undefined; /** U7698: the explanations of the Agent's diff, asked from this file's header and keys. */ explain?: Explanations | undefined; /** U7700c: the defect pass's findings, each drawn by the file that holds its lines. */ findings?: FindingsState | undefined }) => {
  const [selection, setSelection] = createSignal<LineSelection>({ side: "new", start: 1, end: 1 });
  const [focused, setFocused] = createSignal(false);
  const owner = getOwner();

  const { read, failure, setFailure, loading, slow, updated, retry, reread } = createComparisonRead(props);
  const { form, edit, open: openNote, composer, close: closeForm } = createNoteField(props, read, () => focusHost());
  const [renderer, setRenderer] = createSignal<VirtualizedFileDiff<Annotated>>();
  const [coarse, setCoarse] = createSignal(false);
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [shown, setShown] = createSignal<{ path: string; kind: "whitespace" | "large" }>();
  const changes = createChangeCursor();
  let rendered: { path: string; revision: string } | undefined;
  let focusHost = () => {};

  let revealNearest = () => {}, moveTo = (_side: "old" | "new", _line: number) => {};

  const hidden = createMemo(() => hiddenKind(read(), shown()?.path === props.path ? shown()?.kind : undefined));

  const notice = createMemo(() => noticeFor({ value: read(), hidden: hidden(), loading: loading(), slow: slow(), failed: failure() !== null, coarse: coarse(), path: props.path }));

  // Form/caret retention must not rebuild Pierre's DOM or disturb its selection.
  const notes = createMemo(() => props.notes.all(props.id).filter(isLine));

  const { slots, sweep } = createSlots();

  const spotted = createSpotted(() => props.spots, () => props.only, () => props.moves ?? []);

  const moving = createMoving(() => props.moves, () => props.only);

  const gapped = createGapped(() => props.gaps, () => props.only);

  const finding = createFinding({ findings: () => props.findings, path: () => props.path, value: read });

  const explaining = createExplaining({ explain: () => props.explain, path: () => props.path, blob: () => props.blob, value: read, selection });

  onCleanup(() => sweep(undefined));

  const annotation = (metadata: Annotated) => {
    const element = document.createElement("div");
    const draft = untrack(form);

    const content = () => {

      if (isMark(metadata)) return <LineMark metadata={metadata} id={props.id} name={props.name} to={props.to ?? "tree"} openAt={props.openAt} explained={explaining} found={finding} />;

      if ("composing" in metadata) return draft ? <NoteForm id={props.id} comparison={draft.comparison} notes={props.notes} selection={draft.selection} editing={draft.editing} close={closeForm} focus={setFocused} /> : undefined;

      return <NoteView note={metadata} status={metadata.sent !== undefined ? acceptedAs(metadata) : props.notes.noteState(props.id, metadata)} edit={() => edit(metadata)} remove={() => void props.notes.remove(props.id, metadata.id)} />;
    };

    slots.add({ element, metadata, dispose: runWithOwner(owner, () => render(content, element, undefined, { owner })) ?? (() => {}) });

    return element;
  };

  let stamp = (_stamped: Partial<Stamped>) => {};

  createEffect(() => ({ view: renderer(), lines: lineAnnotations(read(), notes(), composer(), spotted(), gapped(), moving(), explaining.marks(), finding.marks()).filter(({ metadata }) => props.only?.(metadata.side, metadata.end) ?? true), active: focused() }), ({ view, lines, active }) => {
    if (!view) return;
    annotate(view, lines, untrack(selection));
    sweep(new Set(lines.map(line => line.metadata)));
    stamp({ noted: lines.flatMap(({ metadata }) => isMark(metadata) ? [] : [{ side: metadata.side, start: metadata.start, end: metadata.end, focused: "composing" in metadata && active }]) });
  });

  // U7704a, U7696a: the lines of a spot and of a move carry the stamps the style keys on, again after each render.
  createEffect(() => ({ view: renderer(), spot: spotted().map(({ start, end }) => ({ start, end })), move: (props.moves ?? []).flatMap(moved => moved.lines) }), ({ view, ...spans }) => { if (view) stamp(spans); });

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
      const drawn = await drawDiff(value, mount, { current: () => current, shared, selection, pick: range => { setSelection(range); changes.place(range); onFocus?.(); remember(); }, note: range => openNote(range), annotation, only: props.only });

      if (!drawn) return;
      const { view, virtualizer, container, fileDiff, coarse } = drawn;

      stamp = drawn.stamp;

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

      if (!await renderedApart(drawn, shared, () => current)) return;

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

      // U7692b: X opens the fold nearest the focused line by the click's step.
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

        stamp = () => {};

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
    const change = target.span && changes.within(target.side, target.span);

    // The annotations of a file drawn by this very jump read the selection as it was before this write: the line lands once they have run.
    queueMicrotask(() => { moveTo(change?.side ?? target.side, change ? change.at[change.side] : target.line); focusHost(); });
    props.arrived?.();
  });

  createEffect(() => props.keys, keys => keys?.({
    at: () => ({ path: props.path, side: selection().side, line: selection().start }), outdated: note => outdated(note, read()), read: () => read(),
    focus: () => focusHost(), reload: () => reload(), reveal: () => revealNearest(), note: () => openNote(selection()), explain: form => explaining.ask(form), edit: () => edit(noteOnLine()),
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

      if (next) moveTo(next.side, next.at[next.side]);

      return next ? "moved" : loading() || props.waiting || (drawableOf(read(), hidden()) && rendered === undefined) ? "wait" : "none";
    },
  }));

  // U7676c: a note whose comparison is not the open one stays in the batch and gathers after the file's last line.
  const gathered = createMemo(() => gatheredNotes(read(), notes()));

  const noteOnLine = () => {
    const at = selection();

    return notes().find(note => note.side === at.side && note.start <= at.start && at.start <= note.end && note.comparison.newPath === props.path);
  };

  const reload = () => { setShown(undefined); reread(); };

  return <section class="diff-reader" aria-label={props.waiting ? undefined : copy.diff} data-waiting={props.waiting || undefined}>
    <header class="diff-header">
      <DiffIdentity read={read()} path={props.path} rank={props.rank} />
      <Show when={props.counts}>{counts => <p class="diff-counts">{copy.addedLines(counts().added)} {copy.removedLines(counts().removed)}</p>}</Show><Show when={props.explain?.offered() && drawableOf(read(), hidden())}><IconButton aria-label={copy.explainWords} onClick={() => explaining.ask("words")}><Icon name="read" /></IconButton><IconButton aria-label={copy.explainDiagram} onClick={() => explaining.ask("diagram")}><Icon name="workflow" /></IconButton></Show><Show when={props.onNote}>{note => <IconButton aria-label={copy.noteOn.file} onClick={event => note()(event.currentTarget)}><Icon name="note-plus" /></IconButton>}</Show>
    </header>{props.under}
    <BlockedFailure message={failure() && `${copy.fileReadFailed(props.path)}: ${failure()}`} content={copy.fileReadFailed(props.path)} recover={loading() ? undefined : { run: retry }} />
    <StatusNote text={failure() || props.waiting ? null : notice()} />
    <Show when={updated()}><div class="mounted-line" role="status"><span>{copy.updatedFile(props.name)}</span> <IconButton aria-label={copy.reload} onClick={reload}><Icon name="rotate-cw" /></IconButton></div></Show>
    <Show when={hidden() === "whitespace" || hidden() === "large"}><div class="mounted-line"><IconButton aria-label={hidden() === "large" ? copy.showAnyway : copy.showWhitespace} onClick={() => setShown({ path: props.path, kind: hidden() === "large" ? "large" : "whitespace" })}><Icon name="down" /></IconButton></div></Show><Show when={props.waiting}><div class="diff-waiting" /></Show>
    <Show when={read()}>{value => <Show when={value().status !== null && drawsLines(value())}><div class="diff-content" tabindex="-1" ref={setHost} /></Show>}</Show>
    <Show when={read()}>{value => <Show when={value().status !== null && imageHidden(value()) === null ? imageSides(value()) : null} keyed>{sides => <ImagePane sides={sides} />}</Show>}</Show>
    <Unshown id={props.id} notes={props.notes} gathered={gathered()} read={read()} spots={props.spots ?? []} drawable={drawableOf(read(), hidden())} only={props.only} />
    <Show when={props.batch !== false}><NoteBatch fallback={() => focusHost()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} comparison={read()} edit={note => { if (isLine(note)) edit(note); }} /></Show>
  </section>;
};
