import { batch, createComputed, createMemo, createSignal, on, untrack, type Accessor } from "solid-js";
import { rowTopology, type NestedRow } from "./todoView";

/** Range aggregates replace #5644's 1,999,000 retained descendant references. */
export const groupFacts = (topology: ReturnType<typeof rowTopology>) => {
  const { rows, end } = topology;
  const done = [0];
  const nextOpen: (number | null)[] = Array(rows.length + 1).fill(null);
  rows.forEach(row => done.push(done.at(-1)! + Number(row.todo.done)));

  for (let at = rows.length - 1; at >= 0; at--) nextOpen[at] = rows[at]!.todo.done ? nextOpen[at + 1]! : at;
  const groups = new Map<number, { start: number; end: number; total: number; done: number; first: number | null }>();
  rows.forEach((row, at) => {
    const stop = end[at]!;

    if (stop === at + 1) return;
    const first = nextOpen[at + 1];
    groups.set(row.todo.id, { start: at + 1, end: stop, total: stop - at - 1, done: done[stop]! - done[at + 1]!, first: first != null && first < stop ? first : null });
  });

  return groups;
};

type Accepted = { rows: readonly NestedRow[]; done: Map<number, boolean>; blocked: Map<number, boolean> };

export type DependencyGroupRetention = {
  topology: ReturnType<typeof rowTopology>;
  groups: ReturnType<typeof groupFacts>;
  listed: ReturnType<typeof groupFacts>;
  visibility: boolean[];
  before: { key: string; done: Map<number, boolean>; blocked: Map<number, boolean> } | null;
  accepted: Accepted;
  choices: Map<string, Map<number, boolean>>;
  pending: { close: number[]; open: number[]; blocked: ReadonlyMap<number, boolean> };
  bars: ReadonlySet<number>;
  strikes: ReadonlySet<number>;
};

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
  observe?: (retained: DependencyGroupRetention) => void;
}) => {
  const cache = choices.get(input.project) ?? new Map<string, Map<number, boolean>>();
  choices.set(input.project, cache);
  const [revision, setRevision] = createSignal(0);
  const [strikes, setStrikes] = createSignal<ReadonlySet<number>>(new Set());
  const [bars, setBars] = createSignal<ReadonlySet<number>>(new Set());
  const [moving, setMoving] = createSignal(false);
  const [pending, setPending] = createSignal<{ close: number[]; open: number[]; blocked: ReadonlyMap<number, boolean> }>({ close: [], open: [], blocked: new Map<number, boolean>() });

  createComputed(() => {
    if (!input.loaded()) return;
    const keys = input.keys();
    const ids = input.ids();

    for (const [key, scope] of cache) {
      if (!keys.has(key)) cache.delete(key);
      else for (const id of scope.keys()) if (!ids.has(id)) scope.delete(id);
    }
  });

  const topology = createMemo(() => rowTopology(input.rows()));
  const groups = createMemo(() => groupFacts(topology()));
  const [listedGroups, setListedGroups] = createSignal<ReturnType<typeof groupFacts>>(new Map());

  const complete = (id: number) => {
    const facts = groups().get(id);

    return !!facts && facts.done === facts.total;
  };

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

  const visibility = createMemo(() => {
    const { rows, parent } = topology();
    const result: boolean[] = [];
    rows.forEach((_row, at) => {
      const above = parent[at];
      result.push(above == null || (result[above]! && expanded(rows[above]!.todo.id)));
    });

    return result;
  });

  const visible = (id: number) => visibility()[topology().index.get(id) ?? -1] ?? true;

  createComputed(() => {
    const visibleBars = [...bars()].filter(id => input.shown(id) && visible(id));

    if (visibleBars.length !== bars().size) setBars(new Set(visibleBars));
  });

  let before: { key: string; done: Map<number, boolean>; blocked: Map<number, boolean> } | null = null;

  const accepted = createMemo(() => {
    const rows = input.rows();

    return { rows, done: new Map(rows.map(row => [row.todo.id, row.todo.done])), blocked: new Map(rows.map(row => [row.todo.id, row.todo.blocked])) };
  });

  createComputed(on([input.loaded, input.key, accepted], ([loaded, key, facts]) => batch(() => {
    const { rows, done, blocked } = facts;
    const was = before;
    before = loaded ? { key, done, blocked } : null;

    const scope = cache.get(key) ?? new Map<number, boolean>();

    for (const id of groups().keys()) if (!scope.has(id)) scope.set(id, !complete(id));
    cache.set(key, scope);

    if (!loaded || !was || key !== was.key) {
      if (was) for (const id of pending().close) {
        const members = listedGroups().get(id);

        if (members && members.done === members.total) cache.get(was.key)?.set(id, false);
      }

      setStrikes(new Set<number>());
      setBars(new Set<number>());
      setMoving(false);
      setPending({ close: [], open: [], blocked: new Map<number, boolean>() });
      setListedGroups(groups());

      return;
    }

    const playing = new Set(bars());
    const changedTitles = new Set([...strikes()].filter(id => groups().has(id)));

    const changed = [0];
    const previouslyOpen = [0];
    rows.forEach(row => {
      const previous = was.done.get(row.todo.id);
      changed.push(changed.at(-1)! + Number(previous !== undefined && previous !== row.todo.done && visible(row.todo.id)));
      previouslyOpen.push(previouslyOpen.at(-1)! + Number(previous === false));
    });

    for (const [id, members] of groups()) {
      const previous = listedGroups().get(id);
      const oldDone = previous?.done ?? 0;
      const newDone = members.done;
      const hasChange = changed[members.end]! !== changed[members.start]!;

      if (hasChange && previous && oldDone * members.total !== newDone * previous.total && !input.reduced() && input.shown(id) && visible(id)) {
        playing.add(id);

        if ((oldDone === previous.total) !== (newDone === members.total)) changedTitles.add(id);
      }
    }

    setBars(playing);
    setStrikes(changedTitles);

    const closed = [...groups()].filter(([id, members]) => complete(id) && previouslyOpen[members.end]! !== previouslyOpen[members.start]!);
    const shown = closed.filter(([id]) => input.shown(id) && untrack(() => expanded(id) && visible(id)));

    if (!closed.length) {
      setPending(request => ({ close: request.close.filter(id => groups().has(id)), open: request.open.filter(id => groups().has(id)), blocked: request.blocked }));
      setListedGroups(groups());

      return;
    }

    // Preserve the currently expanded group through the final child's visible effects.
    for (const [id] of shown) setExpanded(id, true);

    const shownIds = new Set(shown.map(([id]) => id));

    for (const [id] of closed) if (!shownIds.has(id)) setExpanded(id, false);

    const history = pending();
    const baseline = history.close.length > 0 ? history.blocked : was.blocked;
    const retained = history.close.filter(id => groups().has(id));
    const visibleOwners = new Set([...retained, ...shown.map(([id]) => id)].map(input.group));
    const lastByOwner = new Map<string, number>();

    for (const id of new Set([...retained, ...closed.map(([id]) => id)])) {
      const owner = input.group(id);
      const at = topology().index.get(id)!;

      if (visibleOwners.has(owner)) lastByOwner.set(owner, Math.max(lastByOwner.get(owner) ?? -1, at));
    }

    const successors: number[] = [];
    rows.forEach((row, at) => {
      const owner = input.group(row.todo.id);
      const last = lastByOwner.get(owner);

      if (last === undefined || at <= last) return;
      const firstAt = groups().get(row.todo.id)?.first;
      const first = firstAt == null ? undefined : rows[firstAt];

      if (first && baseline.get(first.todo.id) === true && !first.todo.blocked && !complete(row.todo.id)) {
        successors.push(row.todo.id);
        lastByOwner.delete(owner);
      }
    });

    setPending({ close: [...new Set([...pending().close.filter(id => groups().has(id)), ...shown.map(([id]) => id)])], open: successors, blocked: baseline });
    setListedGroups(groups());
  })));

  createComputed(() => batch(() => {
    if (input.reduced() && bars().size) setBars(new Set<number>());

    if (input.playing() || bars().size > 0) return;
    const request = pending();

    if (!request.close.length) return;
    const closing = request.close.filter(complete);
    const hidden = new Set<number>();
    // Union the closing ranges in preorder, so nested completions visit each row once.
    const ranges = closing.map(id => groups().get(id)!).toSorted((a, b) => a.start - b.start);
    let end = 0;

    for (const range of ranges) {
      for (let at = Math.max(end, range.start); at < range.end; at++) hidden.add(topology().rows[at]!.todo.id);
      end = Math.max(end, range.end);
    }

    input.focusAfterClose(hidden);

    for (const id of closing) setExpanded(id, false);

    if (closing.length > 0) for (const id of request.open) {
      const at = groups().get(id)?.first;
      const first = at == null ? undefined : topology().rows[at];

      if (first && !first.todo.blocked) setExpanded(id, true);
    }

    setPending({ close: [], open: [], blocked: new Map<number, boolean>() });
  }));

  createComputed(() => input.observe?.({ topology: topology(), groups: groups(), listed: listedGroups(), visibility: visibility(), before,
    accepted: accepted(), choices: cache, pending: pending(), bars: bars(), strikes: strikes() }));

  return { groups: listedGroups, complete, expanded, visible, setExpanded, moving,
    bar: (id: number) => bars().has(id),
    strike: (id: number) => strikes().has(id) && bars().has(id),
    barEnded: (id: number) => {
      setStrikes(previous => new Set([...previous].filter(other => other !== id)));
      setBars(previous => new Set([...previous].filter(other => other !== id)));
    },
  };
};
