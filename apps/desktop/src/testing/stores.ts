import type { Actor } from "@contracts/Actor";
import type { EventData } from "@contracts/EventData";
import type { Touch } from "@contracts/Touch";
import type { Pad } from "@contracts/pad/Pad";
import type { Change } from "@contracts/todo/Change";
import type { Values } from "@contracts/todo/Values";
import type { Todo } from "@contracts/todo/Todo";
import { RpcError } from "../app/seam";
import type { Handlers } from "./fakeApp";
import { USER } from "./nodes";

const NOT_FOUND = -32001;

const INVALID_PARAMS = -32602;

const CONFLICT = -32003;

/** Where a handler reports the Event the real Daemon would send after the same write. */
export type Announce = (data: EventData) => void;

export type TodoStore = { todos: Todo[]; changes?: Map<number, Change[]>; reads?: Map<number, number> };

export type PadStore = { pads: Pad[]; history: Touch[] };

const find = <T,>(items: T[], matches: (item: T) => boolean, what: string): T => {
  const found = items.find(matches);

  if (!found) throw new RpcError(NOT_FOUND, `not found: ${what}`);

  return found;
};

const withBlocked = (todos: Todo[]): Todo[] =>
  todos.map((todo) => ({
    ...todo,
    blocked: todo.blockers.some((id) => todos.some((other) => other.id === id && !other.done)),
  }));

/** Replaces `store.todos` with `change` applied, derives `blocked`, and announces `todo.updated` for `id` and `todo.unblocked` for every Todo the change freed. */
const values = (todo: Todo): Values => ({ title: todo.title, body: todo.body, done: todo.done, blockers: [...todo.blockers].toSorted(), owner: todo.owner });

const recordChanges = (store: TodoStore, before: Todo[]) => {
  for (const todo of store.todos) {
    const prior = before.find((old) => old.id === todo.id);
    const after = values(todo);

    if (prior && JSON.stringify(values(prior)) === JSON.stringify(after)) continue;
    const changes = store.changes?.get(todo.id) ?? [];

    if (!prior && changes.length) continue;
    const seq = Math.max(0, ...[...(store.changes?.values() ?? [])].flat().map((change) => change.seq)) + 1;
    store.changes?.set(todo.id, [...changes, { seq, before: prior ? values(prior) : null, after }]);
  }
};

const changeTodos = (store: TodoStore, announce: Announce, id: number, change: (todos: Todo[]) => Todo[]): Todo => {
  const before = store.todos;
  store.todos = withBlocked(change(before));
  recordChanges(store, before);
  const updated = find(store.todos, (todo) => todo.id === id, `todo ${id}`);
  announce({ name: "todo.updated", data: updated });

  for (const todo of store.todos) {
    if (before.some((was) => was.id === todo.id && was.blocked) && !todo.blocked) announce({ name: "todo.unblocked", data: { id: todo.id } });
  }

  return { ...updated };
};

/** The Todo methods over `store.todos`, which start in id order as T2 says and change it only by `todo.reorder` (T11); each write also sends the Events the real Daemon sends. */
export const todoHandlers = (store: TodoStore, announce: Announce, actor: () => Actor = () => USER): Handlers => {
  store.todos = store.todos.toSorted((a, b) => a.id - b.id);

  store.changes ??= new Map();
  store.reads ??= new Map();
  recordChanges(store, []);

  return todoMethods(store, announce, actor);
};

const todoMethods = (store: TodoStore, announce: Announce, actor: () => Actor): Handlers => ({
  "todo.list": () => store.todos.map((todo) => ({ ...todo })),
  "todo.get": ({ id }) => {
    const todo = find(store.todos, (todo) => todo.id === id, `todo ${id}`);
    store.reads?.set(id, store.changes?.get(id)?.at(-1)?.seq ?? 0);

    return { ...todo };
  },
  "todo.getHistory": ({ id }) => {
    find(store.todos, (todo) => todo.id === id, `todo ${id}`);
    const changes = store.changes?.get(id) ?? [];

    return { changes, unread: changes.find((change) => change.seq > (store.reads?.get(id) ?? 0))?.seq ?? null };
  },
  "todo.readHistory": ({ id, through }) => {
    store.reads?.set(id, Math.max(through, store.reads?.get(id) ?? 0));

    return null;
  },
  "todo.create": ({ title, body, blockers, owner }) => {
    const id = Math.max(0, ...store.todos.map((todo) => todo.id)) + 1;
    const created: Todo = { id, title, body: body ?? "", done: false, blockers: blockers ?? [], blocked: false, created_at: Date.now(), creator: actor(), home: null, owner: owner ?? null };
    store.todos = withBlocked([...store.todos, created]);
    recordChanges(store, []);
    const stored = find(store.todos, (todo) => todo.id === id, `todo ${id}`);
    announce({ name: "todo.created", data: stored });

    return { ...stored };
  },
  "todo.update": ({ id, title, body }) =>
    changeTodos(store, announce, id, (todos) =>
      todos.map((todo) => (todo.id === id ? { ...todo, title: title ?? todo.title, body: body ?? todo.body } : todo)),
    ),
  "todo.complete": ({ id }) =>
    changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, done: true } : todo))),
  "todo.setBlockers": ({ id, blockers }) =>
    changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, blockers } : todo))),
  "todo.assign": ({ id, owner }) =>
    changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, owner } : todo))),
  "todo.move": ({ id, home }) =>
    changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, home } : todo))),
  "todo.reorder": ({ id, before }) => {
    const moved = find(store.todos, (todo) => todo.id === id, `todo ${id}`);

    if (before !== null) find(store.todos, (todo) => todo.id === before, `todo ${before}`);

    if (before === id) throw new RpcError(CONFLICT, `todo ${id} cannot go before itself`);

    const others = store.todos.filter((todo) => todo.id !== id);
    const at = before === null ? others.length : others.findIndex((todo) => todo.id === before);
    const index = store.todos.findIndex((todo) => todo.id === id);

    if (at === index) return { ...moved };

    return changeTodos(store, announce, id, () => [...others.slice(0, at), moved, ...others.slice(at)]);
  },
  "todo.delete": ({ id }) => {
    find(store.todos, (todo) => todo.id === id, `todo ${id}`);
    const before = store.todos;
    store.todos = withBlocked(store.todos.filter((todo) => todo.id !== id).map((todo) => ({ ...todo, blockers: todo.blockers.filter((blocker) => blocker !== id) })));
    recordChanges(store, before);
    store.changes?.delete(id);
    announce({ name: "todo.deleted", data: { id } });

    return null;
  },
});

const changePad = (store: PadStore, announce: Announce, name: string, change: (pad: Pad) => Pad): Pad => {
  const next = change(find(store.pads, (pad) => pad.name === name, `pad ${name}`));
  store.pads = store.pads.map((pad) => (pad.name === name ? next : pad));
  announce({ name: "pad.changed", data: { name } });

  return { ...next };
};

/** The Pad methods over `store.pads`, with the Provenance history `store.history`; each write also sends `pad.changed`. */
export const padHandlers = (store: PadStore, announce: Announce, actor: () => Actor = () => USER): Handlers => ({
  "pad.list": () => store.pads.map((pad) => ({ ...pad })),
  "pad.read": ({ name }) => ({ ...find(store.pads, (pad) => pad.name === name, `pad ${name}`) }),
  "pad.create": ({ name, text }) => {
    if (name.trim() === "") throw new RpcError(INVALID_PARAMS, "a Pad needs a name");

    if (store.pads.some((pad) => pad.name === name)) throw new RpcError(CONFLICT, `pad ${name} already exists`);

    const created: Pad = { incarnation: crypto.randomUUID(), name, owner: actor(), text: text ?? "", updated_at: Date.now(), revision: 1, home: null };
    store.pads = [...store.pads, created];
    announce({ name: "pad.changed", data: { name } });

    return { ...created };
  },
  "pad.write": ({ name, text }) => changePad(store, announce, name, (pad) => ({ ...pad, text, updated_at: Date.now(), revision: pad.revision + 1 })),
  "pad.append": ({ name, text }) => changePad(store, announce, name, (pad) => ({ ...pad, text: pad.text + text, updated_at: Date.now(), revision: pad.revision + 1 })),
  "pad.move": ({ name, home }) => changePad(store, announce, name, (pad) => ({ ...pad, home })),
  "pad.setOwner": ({ name, owner }) => changePad(store, announce, name, (pad) => ({ ...pad, owner })),
  "pad.delete": ({ name }) => {
    find(store.pads, (pad) => pad.name === name, `pad ${name}`);
    store.pads = store.pads.filter((pad) => pad.name !== name);
    announce({ name: "pad.changed", data: { name } });

    return null;
  },
  "pad.export": () => null,
  "provenance.history": () => store.history,
});
