import { createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
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
  /** The message of the last failed `todo.list`, until a later one succeeds. */
  failure: Accessor<string | null>;
  /** True once the first `todo.list` has answered, so U38's empty line never flashes before it. */
  isLoaded: Accessor<boolean>;
};

const REFETCH_ON = new Set(["todo.created", "todo.updated", "todo.unblocked", "todo.deleted"]);

/** Subscribes before its first fetch, so no Event between the two is lost. */
export const createTodosState = (app: AppSeam, events: Events, project: string): TodosState => {
  // Reconciled by id, so a refetch that changes one Todo leaves every other row untouched.
  const [shelf, setShelf] = createStore<{ todos: Todo[] }>({ todos: [] });
  const [failure, setFailure] = createSignal<string | null>(null);
  const [isLoaded, setIsLoaded] = createSignal(false);

  // Overlapping fetches can answer out of order; only the newest one may write.
  let newest = 0;
  let latest: Promise<void> = Promise.resolve();

  const refetch = async () => {
    newest += 1;

    const mine = newest;
    let list: Todo[] = [];

    const message = await failureOf(async () => {
      list = await app.rpc("todo.list", null);
    });

    if (mine !== newest) {
      await latest;

      return;
    }

    if (message === null) setShelf("todos", reconcile(list, { key: "id" }));

    setFailure(message);
    setIsLoaded(true);
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

  const byId = createMemo(() => new Map(shelf.todos.map((todo) => [todo.id, todo])));

  return { project, reload, all: () => shelf.todos, byId, failure, isLoaded };
};
