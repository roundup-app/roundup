import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Handed } from "@contracts/todo/Handed";
import type { Todo } from "@contracts/todo/Todo";
import type { Events } from "../app/events";
import type { AppSeam } from "../app/seam";
import { failureOf } from "./failureOf";

export type TodosState = {
  /** Original Project path whose list supplied these identities. */
  project: string;
  reload: () => Promise<void>;
  /** The Project's Todos as `todo.list` last answered. */
  all: Accessor<readonly Todo[]>;
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
};

const REFETCH_ON = new Set(["todo.created", "todo.updated", "todo.unblocked", "todo.deleted"]);

/** Subscribes before its first fetch, so no Event between the two is lost. */
export const createTodosState = (app: AppSeam, events: Events, project: string): TodosState => {
  // Reconciled by id, so a refetch that changes one Todo leaves every other row untouched.
  const [shelf, setShelf] = createStore<{ todos: Todo[] }>({ todos: [] });
  const [failure, setFailure] = createSignal<string | null>(null);
  const [handed, setHanded] = createSignal<readonly Handed[] | null>(null);
  const [handedFailure, setHandedFailure] = createSignal<string | null>(null);
  const [isLoaded, setIsLoaded] = createSignal(false);

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

  const all = () => pending().length === 0 ? shelf.todos : [...shelf.todos, ...pending()];
  const byId = createMemo(() => new Map(all().map((todo) => [todo.id, todo])));

  return { project, reload, all, show, revealed, byId, handed, handedFailure, failure, isLoaded };
};
