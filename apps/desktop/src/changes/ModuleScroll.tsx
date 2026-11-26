import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import type { OwnedGroupKey } from "@contracts/agent/OwnedGroupKey";
import { DiffIdentity, DiffReader } from "./DiffReader";
import type { DiffKeys } from "./DiffReader";
import type { Shared } from "./diffDraw";
import type { Place, Places } from "./lines";
import type { Section } from "./modules";
import type { Gap } from "@contracts/agent/Gap";
import type { ScanHit } from "@contracts/agent/ScanHit";
import { shownSpan } from "./repeats";
import type { Moves } from "./moveStore";
import { NoteBatch, type DiffTarget } from "./NoteBatch";
import { isItem } from "./notes";
import type { Item, ItemNote, LineNote, Notes } from "./notes";
import { copy } from "./copy";
import { queueFocus } from "../keys/focus";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { ItemNotes } from "./ItemNoteForm";
import { fileTarget } from "./itemNotes";
import type { Composing } from "./ItemNoteForm";
import type { ItemTarget } from "./itemNotes";

/** U7691a: the form open on an item. The element with focus when it opened takes focus back when it closes, `fallback` when that element left. */
const createComposer = (fallback: () => void) => {
  const [form, setForm] = createSignal<Composing>();
  let opener: Element | null = null;

  const compose = (next: Composing | undefined, from: Element | null = document.activeElement) => {
    if (next) opener = from;
    setForm(next);

    if (!next) queueFocus(() => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); else fallback(); });
  };

  return { form, compose };
};

/** The reader's keys, and U7691a's: N on a list row opens the form of that item. */
export type ScrollKeys = DiffKeys & { noteItem: (item: Pick<Item, "kind" | "name">) => void };

type Line = { side: "old" | "new"; line: number };

/** U7678c: the line a click landed on: Pierre draws each line in its own shadow DOM, so the event's path names it. */
const lineOf = (event: MouseEvent): Line | undefined => {
  const line = event.composedPath().find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.line !== undefined);

  return line && { side: line.dataset.lineType === "change-deletion" ? "old" : "new", line: Number(line.dataset.line) };
};

/** U7678c, U7683d: one module's hunks as one scroll, or a flow's `sections` in call order (a file, or the hunks of one function of it): each under its header, read only once the scroll reports it in view or next after one that is, and a note batch shared by all of them. */
export const ModuleScroll = (props: { id: string; name: string; files: readonly ChangedFile[]; sections?: readonly Section[] | undefined; above?: JSX.Element; start: string | undefined; scroll: { get: () => number | undefined; set: (top: number) => void }; places: Places; keys: (keys: ScrollKeys) => void; /** U7691a: the item this scroll is, when it takes a note; U7691c: whether a Sent note on an item has gone Outdated. */ item?: ItemTarget | undefined; itemOutdated: (note: ItemNote) => boolean; target: DiffTarget | undefined; arrived: () => void; onReady: () => void; to: CompareTarget; group?: OwnedGroupKey | undefined; viewed?: { on: boolean; changed: boolean; toggle: () => void } | undefined; notes: Notes; recover: () => void; open: (path: string, at?: Line) => void; /** U7685a: the scan's repeats, each drawn by the file that holds its lines. */ repeats?: readonly ScanHit[] | undefined; /** U7688e: the readback's gaps, each drawn by the file that holds its line. */ gaps?: readonly Gap[] | undefined; /** U7697a: the words of a file's rank, by path, while the rank order is in force. */ ranks?: ReadonlyMap<string, string> | undefined; /** U7696a: the Logic lens's moves, each drawn by the file that holds its lines. */ moves?: Moves | undefined }) => {
  let scroller: HTMLDivElement | undefined;
  const sections = new Map<string, HTMLElement>();
  const readers = new Map<string, DiffKeys>();
  const [wanted, setWanted] = createSignal<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = createSignal<LineNote>();
  const { form, compose } = createComposer(() => here()?.focus());

  // A module's scroll is its files, keyed by path; a flow's is its sections, keyed by file and function, so a file can appear twice.
  const entries = createMemo((): readonly Section[] => props.sections ?? props.files.map(file => ({ id: file.path, file })));
  const paths = createMemo(() => entries().map(entry => entry.id));
  const entryOf = (id: string) => entries().find(entry => entry.id === id);
  const fileOf = (id: string) => entryOf(id)?.file;
  const firstOf = (path: string) => entries().find(entry => entry.file.path === path)?.id;
  const idOf = (at: string | undefined) => at === undefined ? undefined : entryOf(at) ? at : firstOf(at);
  // A flow keeps each section's place under its own id, since a file in two sections reads two places; a module keeps the file's. One object per id, so the reader never sees a new place.
  const kept = new Map<string, Places>();

  const sectionPlaces = (id: string): Places => {
    if (!props.sections) return props.places;
    const own = kept.get(id) ?? { get: () => props.places.get(id), set: (_file: string, place: Place) => props.places.set(id, place) };

    kept.set(id, own);

    return own;
  };

  // A place sized from the file's counts holds its section until it is read.
  const lines = (path: string) => {
    const counts = fileOf(path)?.counts;

    return Math.min(40, 4 + (counts ? counts.added + counts.removed : 8));
  };

  let current = "";
  let pending: { path: string; direction: 1 | -1 } | undefined;

  const want = (...list: (string | undefined)[]) => setWanted(before => {
    const next = new Set(before);

    for (const path of list) if (path !== undefined) next.add(path);

    return next.size === before.size ? before : next;
  });

  const reported = (path: string) => want(path, paths()[paths().indexOf(path) + 1]);

  // The library reports sections as they near the view; a reported file and the one after it are read.
  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && entry.target instanceof HTMLElement && entry.target.dataset.path !== undefined) reported(entry.target.dataset.path);
  });

  onCleanup(() => observer?.disconnect());

  const offset = (path: string) => {
    const section = sections.get(path);

    return scroller && section ? section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : 0;
  };

  const startPath = () => idOf(props.start) ?? paths()[0];

  const shared: Shared = { scroller: undefined };

  onCleanup(() => shared.virtualizer?.cleanUp());

  onSettled(() => {
    current = startPath() ?? "";

    // The file the scroll opens on is in view by definition; the library's report brings the rest.
    want(current);

    if (scroller) {
      const first = idOf(props.start);

      scroller.scrollTop = first ? offset(first) : props.scroll.get() ?? 0;
      const remember = () => props.scroll.set(scroller?.scrollTop ?? 0);

      // listener-owner: removed in the cleanup below with the scroll.
      scroller.addEventListener("scroll", remember);

      return () => scroller?.removeEventListener("scroll", remember);
    }

    return undefined;
  });

  // U7678c: a file row of the open module moves the scroll to that file.
  createEffect(() => idOf(props.start), start => {
    if (!start || !scroller) return;
    current = start;
    want(start);
    scroller.scrollTop = offset(start);
  });

  // U7678d: `]` and `[` leave a file for the next one with a change, reading it when unread.
  const cross = (from: number, direction: 1 | -1) => {
    for (let at = from + direction; at >= 0 && at < paths().length; at += direction) {
      const path = paths()[at] ?? "";

      want(path);
      const result = readers.get(path)?.enter(direction) ?? "wait";

      if (result === "wait") { pending = { path, direction };

 return; }

      if (result === "moved") { current = path;

 return; }
    }
  };

  const resume = () => {
    if (!pending) return;
    const { path, direction } = pending;
    const result = readers.get(path)?.enter(direction) ?? "wait";

    if (result === "wait") return;
    pending = undefined;

    if (result === "moved") current = path; else cross(paths().indexOf(path), direction);
  };

  const here = () => readers.get(current);

  // U7678c: a double click on a hunk opens its file in the editor at the line it landed on.
  const doubleClicked = (event: MouseEvent) => {
    const id = event.target instanceof Element ? event.target.closest<HTMLElement>(".module-file")?.dataset.path : undefined;
    const path = id === undefined ? undefined : fileOf(id)?.path;

    if (path !== undefined) props.open(path, lineOf(event));
  };

  createEffect(() => props.keys, keys => keys({
    focus: () => here()?.focus(),
    step: direction => {
      pending = undefined;

      if (!here()?.step(direction)) cross(paths().indexOf(current), direction);

      return true;
    },
    enter: () => "none",
    reload: () => { for (const reader of readers.values()) reader.reload(); },
    reveal: () => here()?.reveal(),
    note: () => here()?.note(),
    edit: () => here()?.edit(),
    remove: () => here()?.remove(),
    at: () => here()?.at() ?? { path: fileOf(current)?.path ?? current, side: "new", line: 1 },
    read: () => here()?.read(),
    outdated: note => readers.get(firstOf(note.comparison.newPath) ?? "")?.outdated(note) ?? false,
    noteItem: item => {
      const file = item.kind === "file" ? props.files.find(each => each.path === item.name) : undefined;

      if (item.kind === "file" && file === undefined) return;
      want(file && firstOf(file.path));
      compose({ item });
    },
  }));

  return <div class="module-pane">
    <Show when={props.viewed || props.item}><header class="module-head">
      <Show when={props.viewed}>{viewed => <>
        <Show when={viewed().changed}><span class="module-changed">{copy.changedSinceViewed}</span></Show>
        <button type="button" data-button="quiet" aria-pressed={viewed().on ? "true" : "false"} onClick={() => viewed().toggle()}>{copy.viewed}</button>
      </>}</Show>
      <Show when={props.item}>{item => <IconButton aria-label={copy.noteOn[item().kind]} onClick={event => compose({ item: item() }, event.currentTarget)}><Icon name="note-plus" /></IconButton>}</Show>
    </header></Show>
    <Show when={props.item}>{item => <ItemNotes id={props.id} notes={props.notes} target={item()} form={form()} setForm={compose} outdated={props.itemOutdated} />}</Show>
    {props.above}
    <div class="module-scroll" tabindex="-1" aria-label={props.name} onDblClick={doubleClicked} ref={element => { scroller = element; shared.scroller = element; }}>
    <For each={paths()}>{id => {
      // Memos keep these steady while a refresh brings new file objects, so a reader redraws only when what it draws changes.
      const path = createMemo(() => fileOf(id)?.path ?? id);
      const first = createMemo(() => firstOf(path()) === id);
      const only = createMemo(() => entryOf(id)?.pick);

      // U7691a: a file takes its own note under its header, once in a scroll, and never where the scroll is that file.
      const fileNote = createMemo(() => {
        const file = fileOf(id);

        return file && first() && props.item?.kind !== "file" ? fileTarget(file) : undefined;
      });

      const takeNote = (from: Element) => {
        const target = fileNote();

        if (target) compose({ item: target }, from);
      };

      const repeats = createMemo(() => (props.repeats ?? []).filter(hit => hit.path === path() && shownSpan(hit, only()) !== undefined), { equals: (a, b) => a.length === b.length && a.every((each, at) => each === b[at]) });

      const rank = () => !props.sections ? props.ranks?.get(path()) : undefined;

      const gaps = createMemo(() => (props.gaps ?? []).filter(gap => gap.path === path() && shownSpan({ start: gap.line, end: gap.line }, only()) !== undefined), { equals: (a, b) => a.length === b.length && a.every((each, at) => each === b[at]) });

      return <section class="module-file" data-path={id} style={{ "min-block-size": `calc(var(--space-5) * ${lines(id)})` }} ref={element => { sections.set(id, element); observer?.observe(element); onCleanup(() => { observer?.unobserve(element); sections.delete(id); readers.delete(id); }); }}>
        <Show when={entryOf(id)?.label}>{label => <p class="module-function">{label()}</p>}</Show>
        <Show when={wanted().has(id)} fallback={<header class="diff-header"><DiffIdentity read={undefined} path={path()} rank={rank()} /></header>}>
          <DiffReader shared={shared} batch={false} rank={rank()} counts={fileOf(id)?.counts} id={props.id} name={props.name} path={path()} blob={fileOf(id)?.blob} only={only()} repeats={repeats()} gaps={gaps()} moves={props.moves?.of(path())} onRead={props.moves?.request} openAt={props.open} places={sectionPlaces(id)} to={props.to} group={props.group} notes={props.notes} editing={first() && editing()?.comparison.newPath === path() ? editing() : undefined} onEdited={() => setEditing(undefined)} onNote={fileNote() ? takeNote : undefined} under={<Show when={fileNote()}>{target => <ItemNotes id={props.id} notes={props.notes} target={target()} form={form()} setForm={compose} outdated={props.itemOutdated} />}</Show>} onFocus={() => { current = id; }} target={first() && props.target?.path === path() ? props.target : undefined} arrived={props.arrived} onDrawn={() => { props.onReady(); resume(); }} keys={api => { readers.set(id, api); resume(); }} recover={props.recover} />
        </Show>
      </section>;
    }}</For>
    </div>
    <NoteBatch fallback={() => here()?.focus()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} comparison={undefined} readOf={path => readers.get(firstOf(path) ?? path)?.read()} edit={note => { if (isItem(note)) compose({ item: note.item, editing: note }); else setEditing(note); }} />
  </div>;
};
