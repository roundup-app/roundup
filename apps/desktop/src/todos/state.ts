import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { keyedStore } from "../app/keyedStore";
import { blockerGraph } from "./todoView";
import { copy } from "./copy";
import type { Handed } from "@contracts/todo/Handed";
import type { Todo } from "@contracts/todo/Todo";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";
import type { Actor } from "@contracts/Actor";
import { outcomeOf } from "../app/seam";

/** U5172a: a change of a Todo that the Daemon has not answered. `base` is the value before it, so a read that still holds `base` leaves it pending and one that holds another value than `asked` contradicts it. A reorder holds the ids of the whole list in order. */
export type TodoChange =
  | { kind: "home"; asked: string | null; base: string | null }
  | { kind: "owner"; asked: Actor | null; base: Actor | null }
  | { kind: "reorder"; asked: readonly number[]; base: readonly number[] };

/** U5172a: the order that `todo.reorder` of `id` before `before` asks for (null puts it last). */
export const reorderChange = (all: readonly Todo[], id: number, before: number | null): TodoChange => {
  const base = all.map(todo => todo.id);
  const others = base.filter(other => other !== id);
  const at = before === null ? -1 : others.indexOf(before);

  return { kind: "reorder", base, asked: at < 0 ? [...others, id] : [...others.slice(0, at), id, ...others.slice(at)] };
};

type Value = string | Actor | readonly number[] | null;

/** What `change` reads in `list` for Todo `id`, or undefined when the list does not hold the Todo. */
const valueOf = (list: readonly Todo[], id: number, change: TodoChange): Value | undefined => {
  const todo = list.find(each => each.id === id);

  return todo === undefined ? undefined : change.kind === "reorder" ? list.map(each => each.id) : change.kind === "home" ? todo.home : todo.owner;
};

const same = (left: Value, right: Value): boolean => JSON.stringify(left) === JSON.stringify(right);

export type TodosState = {
  /** Original Project path whose list supplied these identities. */
  project: string;
  reload: () => Promise<void>;
  /** The Project's Todos as `todo.list` last answered. */
  all: Accessor<readonly Todo[]>;
  /** Visible Capture feedback, excluded from all item actions until acknowledged. U5991f: a row stands down once the list holds the Todo it stands for, so no frame shows both. */
  pending: Accessor<readonly Todo[]>;
  /** Every Todo by id, rebuilt once per change of the list, so a row finds its blockers without scanning. */
  byId: Accessor<ReadonlyMap<number, Todo>>;
  /** One adjacency derivation shared by both menus and successive Drawer selections. */
  blockerGraph: Accessor<ReturnType<typeof blockerGraph>>;
  /** Accepted Project Hand-offs in Change.seq order; null means pending/failed, [] means none. */
  handed: Accessor<readonly Handed[] | null>;
  /** Cause of the unavailable Hand-off read, cleared by its next successful refresh. */
  handedFailure: Accessor<string | null>;
  /** The message of the last failed `todo.list`, until a later one succeeds. */
  failure: Accessor<string | null>;
  /** Shows `todo` as a row until the returned call removes it: a create's optimistic row (U3714), which the Daemon's reply confirms or U3715 removes. */
  show: (todo: Todo) => () => void;
  /** Counts shown rows: each is a cue to open the Unassigned group, where the filed Todo lands. */
  revealed: Accessor<number>;
  /** True once the first `todo.list` has answered, so U38's empty line never flashes before it. */
  isLoaded: Accessor<boolean>;
  /** U5172a: the change asked of Todo `id` that the Daemon has not confirmed, or `null`; its row shows the asked value, marked busy. */
  pendingOf: (id: number) => TodoChange | null;
  /** U5172a: runs a change of Todo `id`; a refusal returns its message, an unanswered call keeps `change` shown as pending until an Event or a re-read settles it, and an applied one returns null. */
  ask: (id: number, change: TodoChange, call: () => Promise<object | null>) => Promise<string | null>;
  /** U5172a: registers what shows the one failure line when a read contradicts a pending change. */
  onContradicted: (show: (id: number, message: string) => void) => () => void;
};

const REFETCH_ON = new Set(["todo.restored", "todo.created", "todo.updated", "todo.unblocked", "todo.deleted"]);

/** Subscribes before its first fetch, so no Event between the two is lost. */
export const createTodosState = (app: AppSeam, events: Events, project: string): TodosState => {
  const { storage, rows } = keyedStore<Todo>("id");
  const [list, { refetch }] = createResource(() => app.rpc("todo.list", null), { storage });
  const [facts, { refetch: refetchFacts }] = createResource(() => app.rpc("todo.listHanded", null));
  const [waiting, setWaiting] = createSignal(false);
  const shelf = () => rows() ?? [];
  const isLoaded = () => rows() !== undefined;
  const failure = () => list.error?.message ?? null;
  // Unknown Hand-offs never hold the ordinary list behind an additional read.
  const handed = () => waiting() || list.loading || list.error || facts.loading || facts.error ? null : facts.latest ?? null;
  const handedFailure = () => facts.error?.message ?? null;

  const [asked, setAsked] = createSignal<Readonly<Record<number, TodoChange>>>({});

  /** U5172a: a change stays pending while the list still holds its base; a list that holds another value contradicts it. */
  const pendingOf = (id: number): TodoChange | null => {
    const change = asked()[id];
    const value = change && valueOf(shelf(), id, change);

    return change && value !== undefined && same(value, change.base) ? change : null;
  };

  const contradicted = new Set<(id: number, message: string) => void>();

  // A read that moved a Todo off its base settles the change, so the entry goes once it is judged and a later read cannot revive it.
  createEffect(() => {
    const settledIds: number[] = [];

    for (const [key, change] of Object.entries(asked())) {
      const value = valueOf(shelf(), Number(key), change);

      if (value === undefined || same(value, change.base)) continue;
      settledIds.push(Number(key));

      if (!same(value, change.asked)) contradicted.forEach(show => show(Number(key), copy.changeDidNotApply));
    }

    if (settledIds.length) setAsked(each => Object.fromEntries(Object.entries(each).filter(([key]) => !settledIds.includes(Number(key)))));
  });

  // `createResource` drops a refetch asked in the same microtask as one it started, so a burst of Events shares one read that starts after the last of them.
  let queued: Promise<void> | null = null;
  let newest: Promise<unknown> = Promise.resolve();

  /** Resolves once the newest read has answered: a read that an Event superseded answers with the old list, which must not end a wait. */
  const settled = async () => {
    let seen: Promise<unknown>;

    do {
      seen = newest;
      await seen;
    } while (seen !== newest);
  };

  const reload = () => {
    setWaiting(true);

    queued ??= Promise.resolve().then(() => {
      queued = null;
      newest = Promise.all([refetch(), refetchFacts()]);
      setWaiting(false);
    });

    return queued.then(settled);
  };

  onCleanup(
    events.subscribe((event) => {
      if (REFETCH_ON.has(event.name)) void reload();
    }),
  );

  const [shown, setShown] = createSignal<readonly { todo: Todo; known: ReadonlySet<number> }[]>([]);

  // U5991f: a shown row stands for the first Todo of its title and Owner that the list gained since it was shown.
  const pending = createMemo((): readonly Todo[] => {
    const claimed = new Set<number>();

    return shown().filter(({ todo, known }) => {
      const arrived = shelf().find(each => !known.has(each.id) && !claimed.has(each.id) && each.title === todo.title && same(each.owner, todo.owner));

      if (arrived) claimed.add(arrived.id);

      return !arrived;
    }).map(({ todo }) => todo);
  });

  const [revealed, setRevealed] = createSignal(0);

  const show = (todo: Todo) => {
    setRevealed((count) => count + 1);
    const row = { todo, known: new Set(shelf().map(each => each.id)) };

    setShown((rows) => [...rows, row]);

    return () => setShown((rows) => rows.filter((each) => each !== row));
  };

  const all = createMemo((): readonly Todo[] => {
    let todos: readonly Todo[] = shelf();

    for (const key of Object.keys(asked())) {
      const id = Number(key);
      const change = pendingOf(id);

      if (!change) continue;

      if (change.kind === "reorder") {
        const index = new Map(change.asked.map((each, at) => [each, at]));

        todos = [...todos].sort((left, right) => (index.get(left.id) ?? Infinity) - (index.get(right.id) ?? Infinity));
      } else todos = todos.map(todo => todo.id !== id ? todo : change.kind === "home" ? { ...todo, home: change.asked } : { ...todo, owner: change.asked });
    }

    return todos;
  });

  const graph = createMemo(() => blockerGraph(all()));
  const byId = createMemo(() => new Map(all().map((todo) => [todo.id, todo])));

  // One await like `failureOf`, so a caller resumes in the tick it did before (U3720's reveal races the refetch).
  const ask: TodosState["ask"] = async (id, change, call) => {
    try {
      await call();
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      if (outcomeOf(thrown) === "failed") return thrown.message;
      setAsked(each => ({ ...each, [id]: change }));
    }

    return null;
  };

  const listen: TodosState["onContradicted"] = show => {
    contradicted.add(show);

    return () => contradicted.delete(show);
  };

  return { project, pendingOf, ask, onContradicted: listen, reload, all, pending, show, revealed, byId, blockerGraph: graph, handed, handedFailure, failure, isLoaded };
};
