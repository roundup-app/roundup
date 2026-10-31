import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { copy } from "./copy";
import type { Handed } from "@contracts/todo/Handed";
import type { Todo } from "@contracts/todo/Todo";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";
import type { Actor } from "@contracts/Actor";
import { outcomeOf } from "../app/seam";
import { failureOf } from "./failureOf";

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

const same = (left: Value, right: Value): boolean => JSON.stringify(left) === JSON.stringify(right);

export type TodosState = {
  /** Original Project path whose list supplied these identities. */
  project: string;
  reload: () => Promise<void>;
  /** The Project's Todos as `todo.list` last answered. */
  all: Accessor<readonly Todo[]>;
  /** Visible Capture feedback, excluded from all item actions until acknowledged. */
  pending: Accessor<readonly Todo[]>;
  /** Every Todo by id, rebuilt once per change of the list, so a row finds its blockers without scanning. */
  byId: Accessor<ReadonlyMap<number, Todo>>;
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
  // Reconciled by id, so a refetch that changes one Todo leaves every other row untouched.
  const [shelf, setShelf] = createStore<{ todos: Todo[] }>({ todos: [] });
  const [failure, setFailure] = createSignal<string | null>(null);
  const [handed, setHanded] = createSignal<readonly Handed[] | null>(null);
  const [handedFailure, setHandedFailure] = createSignal<string | null>(null);
  const [isLoaded, setIsLoaded] = createSignal(false);

  const [asked, setAsked] = createStore<Record<number, TodoChange>>({});
  const contradicted = new Set<(id: number, message: string) => void>();

  /** U5172a: a read settles each pending change: the value still at `base` stays pending, `asked` clears the mark, another value clears it and reports one failure. */
  const settle = (list: readonly Todo[]) => {
    for (const [key, change] of Object.entries(asked)) {
      const id = Number(key);
      const todo = list.find(each => each.id === id);
      const value = todo === undefined ? undefined : change.kind === "reorder" ? list.map(each => each.id) : change.kind === "home" ? todo.home : todo.owner;

      if (value !== undefined && same(value, change.base)) continue;
      setAsked(id, undefined!);

      if (value !== undefined && !same(value, change.asked)) contradicted.forEach(show => show(id, copy.changeDidNotApply));
    }
  };

  // Overlapping fetches can answer out of order; only the newest one may write.
  let newest = 0;
  let latest: Promise<void> = Promise.resolve();

  const refetch = async () => {
    newest += 1;

    const mine = newest;
    let list: Todo[] = [];
    let facts: Handed[] = [];
    setHanded(null);

    const listRead = failureOf(async () => { list = await app.rpc("todo.list", null); });
    const factRead = failureOf(async () => { facts = await app.rpc("todo.listHanded", null); });
    const message = await listRead;

    if (mine !== newest) {
      await latest;

      return;
    }

    batch(() => {
      if (message === null) {
        setShelf("todos", reconcile(list, { key: "id" }));
        settle(list);
        setIsLoaded(true);
      }

      setFailure(message);
    });

    // Unknown Hand-offs never hold the ordinary list behind an additional read.
    const factMessage = await factRead;

    if (mine !== newest) {
      await latest;

      return;
    }

    batch(() => {
      setHanded(message === null && factMessage === null ? facts : null);
      setHandedFailure(factMessage);
    });
  };

  const reload = () => {
    latest = refetch();

    return latest;
  };

  onCleanup(
    events.subscribe((event) => {
      if (REFETCH_ON.has(event.name)) void reload();
    }),
  );
  void reload();

  const [pending, setPending] = createSignal<readonly Todo[]>([]);

  const [revealed, setRevealed] = createSignal(0);

  const show = (todo: Todo) => {
    setRevealed((count) => count + 1);
    setPending((rows) => [...rows, todo]);

    return () => setPending((rows) => rows.filter((row) => row !== todo));
  };

  const all = createMemo((): readonly Todo[] => {
    const changes = Object.entries(asked);
    let rows: readonly Todo[] = shelf.todos;

    for (const [key, change] of changes) {
      const id = Number(key);

      if (change.kind === "reorder") {
        const index = new Map(change.asked.map((each, at) => [each, at]));

        rows = [...rows].sort((left, right) => (index.get(left.id) ?? Infinity) - (index.get(right.id) ?? Infinity));
      } else rows = rows.map(todo => todo.id !== id ? todo : change.kind === "home" ? { ...todo, home: change.asked } : { ...todo, owner: change.asked });
    }

    return rows;
  });

  const byId = createMemo(() => new Map(all().map((todo) => [todo.id, todo])));

  // One await like `failureOf`, so a caller resumes in the tick it did before (U3720's reveal races the refetch).
  const ask: TodosState["ask"] = async (id, change, call) => {
    try {
      await call();
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;
      if (outcomeOf(thrown) === "failed") return thrown.message;
      setAsked(id, change);
    }

    return null;
  };

  const listen: TodosState["onContradicted"] = show => {
    contradicted.add(show);

    return () => contradicted.delete(show);
  };

  return { project, pendingOf: id => asked[id] ?? null, ask, onContradicted: listen, reload, all, pending, show, revealed, byId, handed, handedFailure, failure, isLoaded };
};
