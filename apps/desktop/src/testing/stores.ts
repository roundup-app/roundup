import * as v from "valibot";
import { caseFold } from "unicode-case-folding";
import type { Actor } from "@contracts/Actor";
import type { EventData } from "@contracts/EventData";
import type { Touch } from "@contracts/Touch";
import type { Deletion as PadDeletion } from "@contracts/pad/Deletion";
import type { DeleteParams } from "@contracts/pad/DeleteParams";
import type { Pad } from "@contracts/pad/Pad";
import type { Deletion as TodoDeletion } from "@contracts/todo/Deletion";
import type { Change } from "@contracts/todo/Change";
import type { Comment } from "@contracts/todo/Comment";
import type { Values } from "@contracts/todo/Values";
import type { Todo } from "@contracts/todo/Todo";
import { RpcError } from "../app/seam";
import type { Handlers } from "./fakeApp";
import { USER } from "./nodes";

const ownerActor = v.nullable(v.object({ kind: v.picklist(["user", "agent", "ext"]), id: v.string(), parent: v.nullable(v.string()) }));

const NOT_FOUND = -32001;

const INVALID_PARAMS = -32602;

const CONFLICT = -32003;

/** Where a handler reports the Event the real Daemon would send after the same write. */
export type Announce = (data: EventData) => void;

export type TodoStore = { todos: Todo[]; changes?: Map<number, Change[]>; reads?: Map<number, number>; comments?: Map<number, Comment[]>; /** Ref URLs whose Pad or heading the fake Daemon calls gone. */ missing?: Set<string> };

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
const values = (todo: Todo): Values => ({ title: todo.title, body: todo.body, done: todo.done, blockers: [...todo.blockers].toSorted(), owner: todo.owner, estimate_minutes: todo.estimate_minutes, priority: todo.priority });

const recordChanges = (store: TodoStore, before: Todo[], actor: Actor | null) => {
  for (const todo of store.todos) {
    const prior = before.find((old) => old.id === todo.id);
    const after = values(todo);

    if (prior && JSON.stringify(values(prior)) === JSON.stringify(after)) continue;
    const changes = store.changes?.get(todo.id) ?? [];

    if (!prior && changes.length) continue;
    const seq = Math.max(0, ...[...(store.changes?.values() ?? [])].flat().map((change) => change.seq)) + 1;
    store.changes?.set(todo.id, [...changes, { seq, before: prior ? values(prior) : null, after, actor, changed_at: Date.now() }]);
  }
};

const changeTodos = (store: TodoStore, announce: Announce, id: number, change: (todos: Todo[]) => Todo[], actor: Actor): Todo => {
  const before = store.todos;
  store.todos = withBlocked(change(before));
  recordChanges(store, before, actor);
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
  store.comments ??= new Map();
  recordChanges(store, [], null);

  return todoMethods(store, announce, actor);
};

const todoMethods = (store: TodoStore, announce: Announce, actor: () => Actor): Handlers => {
  const deletions = new Map<string, { author: string; chosen: string; result: TodoDeletion; rows: { todo: Todo; at: number; changes: Change[]; comments: Comment[] }[]; edges: { id: number; blockers: number[] }[] }>();

  const retained = (operation: string) => {
    const kept = deletions.get(operation);

    if (kept && kept.author !== JSON.stringify(actor())) throw new RpcError(-32002, "deletion belongs to another Actor");

    return kept;
  };

  return ({
  "todo.list": () => store.todos.map((todo) => ({ ...todo })),
  "todo.listHanded": () => store.todos.flatMap((todo) => {
    const last = store.changes?.get(todo.id)?.findLast(change => change.handed
      || JSON.stringify(change.before?.owner ?? null) !== JSON.stringify(change.after.owner ?? null));

    return todo.owner?.kind === "agent" && last?.handed && JSON.stringify(last.handed) === JSON.stringify(todo.owner)
      ? [{ todo: todo.id, owner: todo.owner, seq: last.seq }] : [];
  }).toSorted((a, b) => a.seq - b.seq),
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
  "todo.create": ({ title, body, blockers, owner, priority }) => {
    const selected = v.parse(ownerActor, owner ?? null);
    const id = Math.max(0, ...store.todos.map((todo) => todo.id)) + 1;
    const created: Todo = { id, title, body: body ?? "", done: false, blockers: blockers ?? [], blocked: false, created_at: Date.now(), updated_at: Date.now(), creator: actor(), home: null, owner: selected, refs: [], estimate_minutes: null, priority: priority ?? null };
    store.todos = withBlocked([...store.todos, created]);
    recordChanges(store, [], actor());
    const stored = find(store.todos, (todo) => todo.id === id, `todo ${id}`);
    announce({ name: "todo.created", data: stored });

    return { ...stored };
  },
  "todo.update": ({ id, title, body, priority }) =>
    changeTodos(store, announce, id, (todos) =>
      todos.map((todo) => (todo.id === id ? { ...todo, title: title ?? todo.title, body: body ?? todo.body, priority: priority === undefined ? todo.priority : priority } : todo)), actor(),
    ),
  "todo.complete": ({ id }) =>
    changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, done: true } : todo)), actor()),
  "todo.reopen": ({ id }) => {
    const todo = find(store.todos, (todo) => todo.id === id, `todo ${id}`);

    if (!todo.done) return { ...todo };

    return changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, done: false } : todo)), actor());
  },
  "todo.setBlockers": ({ id, blockers }) =>
    changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, blockers } : todo)), actor()),
  "todo.assign": ({ id, owner }) => {
    const selected = v.parse(ownerActor, owner ?? null);

    return changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, owner: selected } : todo)), actor());
  },
  "todo.move": ({ id, home }) =>
    changeTodos(store, announce, id, (todos) => todos.map((todo) => (todo.id === id ? { ...todo, home } : todo)), actor()),
  "todo.reorder": ({ id, before }) => {
    const moved = find(store.todos, (todo) => todo.id === id, `todo ${id}`);

    if (before !== null) find(store.todos, (todo) => todo.id === before, `todo ${before}`);

    if (before === id) throw new RpcError(CONFLICT, `todo ${id} cannot go before itself`);

    const others = store.todos.filter((todo) => todo.id !== id);
    const at = before === null ? others.length : others.findIndex((todo) => todo.id === before);
    const index = store.todos.findIndex((todo) => todo.id === id);

    if (at === index) return { ...moved };

    return changeTodos(store, announce, id, () => [...others.slice(0, at), moved, ...others.slice(at)], actor());
  },
  "todo.comment": ({ id, body }) => {
    find(store.todos, (todo) => todo.id === id, `todo ${id}`);

    if (body.trim() === "") throw new RpcError(INVALID_PARAMS, "a comment needs a body");

    const thread = store.comments?.get(id) ?? [];
    const next = Math.max(0, ...[...(store.comments?.values() ?? [])].flat().map((comment) => comment.id)) + 1;
    const comment: Comment = { id: next, author: actor(), body: body.trim(), created_at: Date.now(), read: actor().kind === "user" };
    store.comments?.set(id, [...thread, comment]);
    announce({ name: "todo.commented", data: { id } });

    return { ...comment };
  },
  "todo.comments": ({ id }) => {
    find(store.todos, (todo) => todo.id === id, `todo ${id}`);

    return (store.comments?.get(id) ?? []).map((comment) => ({ ...comment }));
  },
  "todo.unread": () => store.todos.flatMap((todo) => (store.comments?.get(todo.id) ?? []).filter((comment) => !comment.read).map((comment) => ({ todo: todo.id, title: todo.title, comment: { ...comment } }))),
  "todo.markCommentsRead": ({ id }) => {
    find(store.todos, (todo) => todo.id === id, `todo ${id}`);
    const thread = store.comments?.get(id) ?? [];

    if (thread.some((comment) => !comment.read)) {
      store.comments?.set(id, thread.map((comment) => ({ ...comment, read: true })));
      announce({ name: "todo.commentsRead", data: { id } });
    }

    return null;
  },
  "todo.addRef": ({ id, url }) => {
    const target = find(store.todos, (todo) => todo.id === id, `todo ${id}`);

    if (target.refs.includes(url)) return { ...target };

    store.todos = store.todos.map((todo) => (todo.id === id ? { ...todo, refs: [...todo.refs, url] } : todo));
    announce({ name: "todo.refAdded", data: { id } });

    return { ...find(store.todos, (todo) => todo.id === id, `todo ${id}`) };
  },
  "todo.removeRef": ({ id, url }) => {
    const target = find(store.todos, (todo) => todo.id === id, `todo ${id}`);

    if (!target.refs.includes(url)) return { ...target };

    store.todos = store.todos.map((todo) => (todo.id === id ? { ...todo, refs: todo.refs.filter((ref) => ref !== url) } : todo));
    announce({ name: "todo.refRemoved", data: { id } });

    return { ...find(store.todos, (todo) => todo.id === id, `todo ${id}`) };
  },
  "todo.refs": ({ id }) => find(store.todos, (todo) => todo.id === id, `todo ${id}`).refs.map((url) => ({ url, state: store.missing?.has(url) ? "missing" : "ok" })),
  "todo.delete": ({ operation, ids }) => {
    const chosen = JSON.stringify([...new Set(ids)].toSorted((a, b) => a - b));
    const prior = retained(operation);

    if (prior) {
      if (prior.chosen !== chosen) throw new RpcError(CONFLICT, "deletion key already names another chosen set");

      return structuredClone(prior.result);
    }

    const rows = store.todos.flatMap((todo, at) => ids.includes(todo.id) ? [{ todo: structuredClone(todo), at, changes: structuredClone(store.changes?.get(todo.id) ?? []), comments: structuredClone(store.comments?.get(todo.id) ?? []) }] : []);
    const deleted = rows.map(row => row.todo.id).toSorted((a, b) => a - b);
    const result: TodoDeletion = { operation, deleted, missing: [...new Set(ids)].filter(id => !deleted.includes(id)).toSorted((a, b) => a - b), state: "deleted" };
    const edges = store.todos.filter(todo => !deleted.includes(todo.id) && todo.blockers.some(id => deleted.includes(id))).map(todo => ({ id: todo.id, blockers: todo.blockers.filter(id => deleted.includes(id)) }));
    const before = store.todos;
    store.todos = withBlocked(store.todos.filter(todo => !deleted.includes(todo.id)).map(todo => ({ ...todo, blockers: todo.blockers.filter(id => !deleted.includes(id)) })));
    recordChanges(store, before, actor());

    for (const id of deleted) {
      store.comments?.delete(id);
      store.changes?.delete(id);
      announce({ name: "todo.deleted", data: { id } });
    }

    deletions.set(operation, { author: JSON.stringify(actor()), chosen, result, rows, edges });

    return structuredClone(result);
  },
  "todo.deletion": ({ operation }) => structuredClone(retained(operation)?.result ?? null),
  "todo.restore": ({ operation }) => {
    const kept = retained(operation);

    if (!kept) throw new RpcError(NOT_FOUND, "deletion not found");

    if (kept.result.state === "restored") return structuredClone(kept.result);

    if (kept.rows.some(row => store.todos.some(todo => todo.id === row.todo.id))) throw new RpcError(CONFLICT, "Todo identity collision");
    const allIds = [...store.todos.map(todo => todo.id), ...kept.result.deleted];

    if (kept.edges.some(edge => !allIds.includes(edge.id)) || kept.rows.some(row => row.todo.blockers.some(id => !allIds.includes(id)))) throw new RpcError(CONFLICT, "blocker endpoint missing");
    const before = store.todos;
    const next = store.todos.map(todo => ({ ...todo, blockers: [...new Set([...todo.blockers, ...(kept.edges.find(edge => edge.id === todo.id)?.blockers ?? [])])].toSorted((a, b) => a - b) }));

    for (const row of kept.rows) next.splice(Math.min(row.at, next.length), 0, structuredClone(row.todo));
    store.todos = withBlocked(next);
    recordChanges(store, before, actor());

    for (const row of kept.rows) {
      store.changes?.set(row.todo.id, structuredClone(row.changes));
      store.comments?.set(row.todo.id, structuredClone(row.comments));
    }

    kept.result = { ...kept.result, state: "restored" };

    for (const todo of store.todos.filter(todo => kept.result.deleted.includes(todo.id) || kept.edges.some(edge => edge.id === todo.id))) announce({ name: "todo.restored", data: { ...todo } });

    return structuredClone(kept.result);
  },
});
};


const padKey = (name: string) => caseFold(name.normalize("NFD"));

const changePad = (store: PadStore, announce: Announce, name: string, change: (pad: Pad) => Pad): Pad => {
  const next = change(find(store.pads, (pad) => padKey(pad.name) === padKey(name), `pad ${name}`));
  store.pads = store.pads.map((pad) => (padKey(pad.name) === padKey(name) ? next : pad));
  announce({ name: "pad.changed", data: { name: next.name } });

  return { ...next };
};

/** The Pad methods over `store.pads`, with the Provenance history `store.history`; each write also sends `pad.changed`. */
export const padHandlers = (store: PadStore, announce: Announce, actor: () => Actor = () => USER): Handlers => {
  const request = (p: DeleteParams) => JSON.stringify([p.name, p.operation ?? null, p.expectedIncarnation ?? null]);
  const project = crypto.randomUUID();
  const deletions = new Map<string, { receipt: PadDeletion; actor: string; request: string }>();

  const retained = (operation: string) => {
    const entry = deletions.get(operation);

    if (!entry) throw new RpcError(NOT_FOUND, "Pad deletion operation not found");

    if (entry.actor !== JSON.stringify(actor())) throw new RpcError(-32002, "deletion belongs to another Actor");

    return entry;
  };

  return {
    "pad.list": () => store.pads.map((pad) => ({ ...pad })),
    "pad.read": ({ name }) => ({ ...find(store.pads, (pad) => padKey(pad.name) === padKey(name), `pad ${name}`) }),
    "pad.create": ({ name, text }) => {
      if (name.trim() === "") throw new RpcError(INVALID_PARAMS, "a Pad needs a name");

      if (store.pads.some((pad) => padKey(pad.name) === padKey(name))) throw new RpcError(CONFLICT, `pad ${name} already exists`);

      const created: Pad = { incarnation: crypto.randomUUID(), name, text: text ?? "", updated_at: Date.now(), revision: 1, home: null };
      store.pads = [...store.pads, created];
      announce({ name: "pad.changed", data: { name } });

      return { ...created };
    },
    "pad.write": ({ name, text, expectedIncarnation, expectedRevision }) => changePad(store, announce, name, (pad) => {

      if (expectedIncarnation != null && expectedIncarnation !== pad.incarnation) throw new RpcError(CONFLICT, "the original pad creation changed");

      if (expectedRevision != null && expectedRevision !== pad.revision) throw new RpcError(CONFLICT, "the pad revision changed");

      return text === pad.text ? pad : { ...pad, text, updated_at: Date.now(), revision: pad.revision + 1 };
    }),
    "pad.rename": ({ name, newName, expectedIncarnation }) => {
      const pad = find(store.pads, (entry) => padKey(entry.name) === padKey(name), `pad ${name}`);


      if (pad.incarnation !== expectedIncarnation || pad.name !== name) throw new RpcError(CONFLICT, "the original pad creation changed");

      if (newName === "" || newName.startsWith(".") || /[/\\\0]/.test(newName) || newName.includes("..")) throw new RpcError(INVALID_PARAMS, "invalid pad name");

      if (store.pads.some((entry) => entry.incarnation !== pad.incarnation && padKey(entry.name) === padKey(newName))) throw new RpcError(CONFLICT, "pad exists");

      if (name === newName) return { ...pad };

      const renamed = changePad(store, announce, name, (entry) => ({ ...entry, name: newName }));
      announce({ name: "pad.renamed", data: { name: newName, previous_name: name, incarnation: pad.incarnation } });

      return renamed;
    },
    "pad.append": ({ name, text }) => changePad(store, announce, name, (pad) => ({ ...pad, text: pad.text + text, updated_at: Date.now(), revision: pad.revision + 1 })),
    "pad.move": ({ name, home }) => changePad(store, announce, name, (pad) => ({ ...pad, home })),
    "pad.reorder": ({ name, before, expectedIncarnation }) => {
      if (actor().kind !== "user") throw new RpcError(-32002, "only the user may reorder pads");
      const pad = find(store.pads, entry => padKey(entry.name) === padKey(name), `pad ${name}`);

      if (pad.incarnation !== expectedIncarnation || pad.name !== name) throw new RpcError(CONFLICT, "the original pad creation changed");
      const target = before === null ? null : find(store.pads, entry => padKey(entry.name) === padKey(before), `pad ${before}`);

      if (target && (target === pad || target.home !== pad.home)) throw new RpcError(CONFLICT, "reorder needs another pad of the same Home");
      const order = store.pads.filter(entry => entry !== pad);
      order.splice(target ? order.indexOf(target) : order.length, 0, pad);
      store.pads = order;
      announce({ name: "pad.changed", data: { name } });

      return { ...pad };
    },
    "pad.delete": (p: DeleteParams) => {
      if (p.operation != null && (p.operation.length === 0 || p.operation.length > 256)) throw new RpcError(INVALID_PARAMS, "invalid deletion operation");

      if (p.operation && deletions.has(p.operation)) {
        const entry = retained(p.operation);

        if (entry.request !== request(p)) throw new RpcError(CONFLICT, "deletion operation already used");

        return structuredClone(entry.receipt);
      }

      const pad = find(store.pads, (pad) => padKey(pad.name) === padKey(p.name), `pad ${p.name}`);


      if (p.expectedIncarnation != null && p.expectedIncarnation !== pad.incarnation) throw new RpcError(CONFLICT, "Pad creation changed");
      const receipt: PadDeletion = { project, operation: p.operation ?? crypto.randomUUID(), pad: structuredClone(pad), restored: false };
      deletions.set(receipt.operation, { receipt, actor: JSON.stringify(actor()), request: request(p) });
      store.pads = store.pads.filter((item) => item !== pad);
      announce({ name: "pad.changed", data: { name: pad.name } });

      return structuredClone(receipt);
    },
    "pad.getDeletion": ({ operation }) => structuredClone(retained(operation).receipt),
    "pad.restore": (id) => {
      if (id.project !== project) throw new RpcError(-32002, "deletion belongs to another Project");
      const { receipt } = retained(id.operation);

      if (receipt.restored) return structuredClone(receipt);

      if (store.pads.some((pad) => padKey(pad.name) === padKey(receipt.pad.name))) throw new RpcError(CONFLICT, "Pad name is in use");
      store.pads = [...store.pads, structuredClone(receipt.pad)];
      receipt.restored = true;
      announce({ name: "pad.changed", data: { name: receipt.pad.name } });

      return structuredClone(receipt);
    },
    "pad.export": () => null,
    "provenance.history": () => store.history,
  };
};
