import { createComputed, createMemo, createSignal, on, untrack, type Accessor } from "solid-js";
import type { NestedRow } from "./todoView";

const choices = new WeakMap<object, Map<string, Map<number, boolean>>>();

/** U3809/U3811: disclosure belongs to this Project/scope; accepted descendant facts choose automatic folds, CSS completion releases them. */
export const createDependencyGroups = (input: {
  project: object;
  key: Accessor<string>;
  keys: Accessor<ReadonlySet<string>>;
  ids: Accessor<ReadonlySet<number>>;
  loaded: Accessor<boolean>;
  rows: Accessor<readonly NestedRow[]>;
  playing: Accessor<boolean>;
  reduced: Accessor<boolean>;
  shown: (id: number) => boolean;
  group: (id: number) => string;
  focusAfterClose: (ids: ReadonlySet<number>) => void;
}) => {
  const cache = choices.get(input.project) ?? new Map<string, Map<number, boolean>>();
  choices.set(input.project, cache);
  const [revision, setRevision] = createSignal(0);
  const [strikes, setStrikes] = createSignal<ReadonlySet<number>>(new Set());
  const [bars, setBars] = createSignal<ReadonlySet<number>>(new Set());
  const [moving, setMoving] = createSignal(false);
  const [pending, setPending] = createSignal<{ close: number[]; open: number[] }>({ close: [], open: [] });

  createComputed(() => {
    if (!input.loaded()) return;
    const keys = input.keys();
    const ids = input.ids();

    for (const [key, scope] of cache) {
      if (!keys.has(key)) cache.delete(key);
      else for (const id of scope.keys()) if (!ids.has(id)) scope.delete(id);
    }
  });

  const groups = createMemo(() => {
    const rows = input.rows();
    const result = new Map<number, readonly NestedRow[]>();

    rows.forEach((row, at) => {
      const end = rows.findIndex((next, index) => index > at && next.level <= row.level);
      const descendants = rows.slice(at + 1, end < 0 ? rows.length : end);

      if (descendants.length) result.set(row.todo.id, descendants);
    });

    return result;
  });

  const [listedGroups, setListedGroups] = createSignal<ReadonlyMap<number, readonly NestedRow[]>>(new Map());

  const complete = (id: number) => groups().get(id)?.every(row => row.todo.done) ?? false;

  const expanded = (id: number): boolean => {
    revision();

    return cache.get(input.key())?.get(id) ?? !complete(id);
  };

  const setExpanded = (id: number, value: boolean) => {
    setMoving(true);
    const scope = cache.get(input.key()) ?? new Map<number, boolean>();
    scope.set(id, value);
    cache.set(input.key(), scope);
    setRevision(value => value + 1);
  };

  const visible = (id: number) => {
    let row = input.rows().find(row => row.todo.id === id);
    const seen = new Set<number>();

    while (row?.parent != null && !seen.has(row.parent)) {
      seen.add(row.parent);

      if (!expanded(row.parent)) return false;
      row = input.rows().find(next => next.todo.id === row!.parent);
    }

    return true;
  };

  createComputed(() => {
    const visibleBars = [...bars()].filter(id => input.shown(id) && visible(id));

    if (visibleBars.length !== bars().size) setBars(new Set(visibleBars));
  });

  let before: { key: string; done: Map<number, boolean>; blocked: Map<number, boolean> } | null = null;

  createComputed(on([input.loaded, input.key, input.rows], ([loaded, key, rows]) => {
    const was = before;
    before = loaded ? { key, done: new Map(rows.map(row => [row.todo.id, row.todo.done])), blocked: new Map(rows.map(row => [row.todo.id, row.todo.blocked])) } : null;

    const scope = cache.get(key) ?? new Map<number, boolean>();

    for (const id of groups().keys()) if (!scope.has(id)) scope.set(id, !complete(id));
    cache.set(key, scope);

    if (!loaded || !was || key !== was.key) {
      if (was) for (const id of pending().close) {
        const members = listedGroups().get(id);

        if (members?.every(row => was.done.get(row.todo.id) === true)) cache.get(was.key)?.set(id, false);
      }

      setStrikes(new Set<number>());
      setBars(new Set<number>());
      setMoving(false);
      setPending({ close: [], open: [] });
      setListedGroups(groups());

      return;
    }

    const playing = new Set(bars());
    const changedTitles = new Set([...strikes()].filter(id => groups().has(id)));

    for (const [id, members] of groups()) {
      const previousMembers = listedGroups().get(id);
      const oldDone = previousMembers?.filter(row => row.todo.done).length ?? 0;
      const newDone = members.filter(row => row.todo.done).length;

      const changed = members.some(row => was.done.has(row.todo.id) && was.done.get(row.todo.id) !== row.todo.done && visible(row.todo.id));

      if (changed && previousMembers && oldDone * members.length !== newDone * previousMembers.length && !input.reduced() && input.shown(id) && visible(id)) {
        playing.add(id);

        if ((oldDone === previousMembers.length) !== (newDone === members.length)) changedTitles.add(id);
      }
    }

    setBars(playing);
    setStrikes(changedTitles);

    const closed = [...groups()].filter(([id, members]) => complete(id) && members.some(row => was.done.get(row.todo.id) === false));
    const shown = closed.filter(([id]) => input.shown(id) && untrack(() => expanded(id) && visible(id)));

    if (!closed.length) {
      setPending(request => ({ close: request.close.filter(id => groups().has(id)), open: request.open.filter(id => groups().has(id)) }));
      setListedGroups(groups());

      return;
    }

    // Preserve the currently expanded group through the final child's visible effects.
    for (const [id] of shown) setExpanded(id, true);

    for (const [id] of closed.filter(([id]) => !shown.some(([other]) => other === id))) setExpanded(id, false);

    const lastByOwner = new Map<string, number>();

    for (const [id] of shown) {
      const at = rows.findIndex(row => row.todo.id === id);
      lastByOwner.set(input.group(id), at);
    }

    const successors = [...lastByOwner.values()].flatMap(last => {
      const candidate = rows.slice(last + 1).find(row => {
        const first = groups().get(row.todo.id)?.find(member => !member.todo.done);

        return input.group(row.todo.id) === input.group(rows[last]!.todo.id) && first && was.blocked.get(first.todo.id) === true && !first.todo.blocked && !complete(row.todo.id);
      });

      return candidate ? [candidate.todo.id] : [];
    });

    setPending({ close: [...new Set([...pending().close.filter(id => groups().has(id)), ...shown.map(([id]) => id)])], open: successors });
    setListedGroups(groups());
  }));

  createComputed(() => {
    if (input.reduced() && bars().size) setBars(new Set<number>());

    if (input.playing() || bars().size > 0) return;
    const request = pending();

    if (!request.close.length) return;
    const closing = request.close.filter(complete);
    const hidden = new Set(closing.flatMap(id => groups().get(id)?.map(row => row.todo.id) ?? []));
    input.focusAfterClose(hidden);

    for (const id of closing) setExpanded(id, false);

    if (closing.length > 0) for (const id of request.open) {
      const first = groups().get(id)?.find(row => !row.todo.done);

      if (first && !first.todo.blocked) setExpanded(id, true);
    }

    setPending({ close: [], open: [] });
  });

  return { groups: listedGroups, complete, expanded, visible, setExpanded, moving,
    bar: (id: number) => bars().has(id),
    strike: (id: number) => strikes().has(id) && bars().has(id),
    barEnded: (id: number) => {
      setStrikes(previous => new Set([...previous].filter(other => other !== id)));
      setBars(previous => new Set([...previous].filter(other => other !== id)));
    },
  };
};
