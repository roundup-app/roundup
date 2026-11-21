import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import { DiffReader } from "./DiffReader";
import type { DiffKeys, DiffTarget } from "./DiffReader";
import type { Shared } from "./diffDraw";
import type { Places } from "./lines";
import { NoteBatch } from "./NoteBatch";
import type { Note, Notes } from "./notes";

/** U7678c: one module's hunks as one scroll: each file under its header, read only once the scroll reports it in view or next after one that is, and a note batch shared by all of them. */
export const ModuleScroll = (props: { id: string; name: string; files: readonly ChangedFile[]; start: string | undefined; scroll: { get: () => number | undefined; set: (top: number) => void }; places: Places; keys: (keys: DiffKeys) => void; target: DiffTarget | undefined; arrived: () => void; onReady: () => void; to: CompareTarget; notes: Notes; recover: () => void }) => {
  let scroller: HTMLDivElement | undefined;
  const sections = new Map<string, HTMLElement>();
  const readers = new Map<string, DiffKeys>();
  const [wanted, setWanted] = createSignal<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = createSignal<Note>();
  const paths = createMemo(() => props.files.map(file => file.path));
  const fileOf = (path: string) => props.files.find(file => file.path === path);

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

  const startPath = () => props.start ?? paths()[0];

  const shared: Shared = { scroller: undefined };

  onCleanup(() => shared.virtualizer?.cleanUp());

  onSettled(() => {
    current = startPath() ?? "";

    // The file the scroll opens on is in view by definition; the library's report brings the rest.
    want(current);

    if (scroller) {
      scroller.scrollTop = props.start ? offset(props.start) : props.scroll.get() ?? 0;
      const remember = () => props.scroll.set(scroller?.scrollTop ?? 0);

      // listener-owner: removed in the cleanup below with the scroll.
      scroller.addEventListener("scroll", remember);

      return () => scroller?.removeEventListener("scroll", remember);
    }

    return undefined;
  });

  // U7678c: a file row of the open module moves the scroll to that file.
  createEffect(() => props.start, start => {
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
    at: () => here()?.at() ?? { path: current, side: "new", line: 1 },
    outdated: note => readers.get(note.comparison.newPath)?.outdated(note) ?? false,
  }));

  return <div class="module-pane">
    <div class="module-scroll" tabindex="-1" aria-label={props.name} ref={element => { scroller = element; shared.scroller = element; }}>
    <For each={paths()}>{path => <section class="module-file" data-path={path} style={{ "min-block-size": `calc(var(--space-5) * ${lines(path)})` }} ref={element => { sections.set(path, element); observer?.observe(element); onCleanup(() => { observer?.unobserve(element); sections.delete(path); readers.delete(path); }); }}>
      <Show when={wanted().has(path)} fallback={<header class="diff-header"><p class="diff-path">{path}</p></header>}>
        <DiffReader shared={shared} batch={false} counts={fileOf(path)?.counts} id={props.id} name={props.name} path={path} blob={fileOf(path)?.blob} places={props.places} to={props.to} notes={props.notes} editing={editing()?.comparison.newPath === path ? editing() : undefined} onEdited={() => setEditing(undefined)} onFocus={() => { current = path; }} target={props.target?.path === path ? props.target : undefined} arrived={props.arrived} onDrawn={() => { props.onReady(); resume(); }} keys={api => { readers.set(path, api); resume(); }} recover={props.recover} />
      </Show>
    </section>}</For>
    </div>
    <NoteBatch fallback={() => here()?.focus()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} comparison={undefined} edit={setEditing} />
  </div>;
};
