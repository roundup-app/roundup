import { debounce } from "@solid-primitives/scheduled";
import { createEffect, createMemo, createSignal, flush, untrack, type Accessor } from "solid-js";
import type { TreeItemData } from "@ui-sdk/solid/tree";
import type { RailNode as ProjectNode } from "@contracts/agent/RailNode";
import { KIND_ICON } from "../ink/kindIcon";
import type { ConnectedProject } from "../state/connectedProject";
import { easingOut, reorderMs, translateOf } from "../ui/reorderMotion";
import { branchesOf, railItems } from "./collection";
import { copy } from "./copy";
import { foldIdOf, layoutRail, type NodeRow, type RailRow } from "./layout";
import { isWorkstream } from "../state/railTopology";
import { placeable } from "./placement";
import type { RailSection } from "../state/railStorage";

export const sections: { id: RailSection; label: string; icon: typeof KIND_ICON[keyof typeof KIND_ICON] }[] = [
  { id: "workstreams", label: copy.workstreamsHead, icon: KIND_ICON.workstream },
  { id: "modes", label: copy.modesHead, icon: KIND_ICON.mode },
  { id: "agents", label: copy.agentsHead, icon: KIND_ICON.agent },
];

export const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((each, at) => each === b[at]);

/** A copy a pending change made of a node it did not change is the node: equal field by field. */
const sameNode = (a: ProjectNode, b: ProjectNode): boolean => {
  if (a === b) return true;
  // SAFETY: Object.keys of a RailNode lists its own fields, each a key of RailNode.
  const keys = Object.keys(a) as (keyof ProjectNode)[];

  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
};

const sameRow = (a: RailRow, b: RailRow): boolean => {
  if (a.kind === "node" && b.kind === "node") return sameNode(a.node, b.node) && a.depth === b.depth && a.children === b.children && sameList(a.trail, b.trail)
    && (a.collapsed === null ? b.collapsed === null : b.collapsed !== null && sameList(a.collapsed.agents, b.collapsed.agents));

  return a.kind === "fold" && b.kind === "fold" && a.depth === b.depth && a.parent === b.parent && a.group === b.group && a.status === b.status && a.count === b.count && a.open === b.open && sameList(a.trail, b.trail);
};

/** The animations on a row that run its translate. */
const cancelTranslates = (row: HTMLElement) => {
  for (const animation of row.getAnimations()) {
    const translating = animation instanceof CSSTransition ? animation.transitionProperty === "translate" : animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => "translate" in frame);

    if (translating) animation.cancel();
  }
};

/** U6550a, M5: a lift or cancel by key is immediate (M1); a lift or cancel changes the rows in one frame; rows that stay slide from where they were drawn (once the sortable has cleared its own shifts) and rows that return fade in, on the reorder Tokens. Call the returned function just before the lift changes. */
const createLiftMotion = (container: Accessor<HTMLElement | undefined>, lifted: Accessor<string | null>) => {
  let drawn = new Map<string, number>();
  let keyed = false;
  const slides = new WeakMap<HTMLElement, Animation>();
  const rows = () => [...container()?.querySelectorAll<HTMLElement>(".rail-row[data-id]") ?? []];

  createEffect(lifted, () => { queueMicrotask(() => {
    const before = drawn;
    const reduced = matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    drawn = new Map();

    if (reduced || keyed || before.size === 0) return;

    const moving = rows().filter(row => "animate" in row && !row.matches("[data-dnd-dragging], [data-dnd-dropping]"));

    // A row slides once, by its real displacement: a translate still running on it would be read into the distance and added to it.
    for (const row of moving) if (!row.style.translate) { slides.get(row)?.cancel(); cancelTranslates(row); }

    // A translate that outlived the cancel is not part of the row's place.
    const tops = moving.map(row => row.getBoundingClientRect().top - translateOf(row).y);

    moving.forEach((row, at) => {
      const was = before.get(row.dataset.id!);
      const options = { duration: reorderMs(row), easing: easingOut(row) };

      if (was === undefined) row.animate({ opacity: [0, 1] }, options);
      // A row the sortable shifted slides itself from that shift; a second translate here would double it.
      else if (!row.style.translate && Math.abs(was - tops[at]!) >= 1) slides.set(row, row.animate({ translate: [`0 ${was - tops[at]!}px`, "0 0"] }, options));
    });
  }); }, { defer: true });

  // A row inside a collapsed group is inert and not drawn: it returns by fading in, never by sliding from where the hidden group left it.
  return (keyboard: boolean) => { keyed = keyboard; drawn = new Map(rows().filter(row => !row.closest("[inert], [hidden]")).map(row => [row.dataset.id!, row.getBoundingClientRect().top])); };
};

export const createRailTree = (connected: ConnectedProject, unfolded: Accessor<ReadonlySet<string | null>>, container: Accessor<HTMLElement | undefined> = () => undefined) => {
  const { rail, now } = connected;
  /** U6550a: the row a drag holds; its children fold under it until the drop is shown. */
  const [lifted, setLifted] = createSignal<string | null>(null);
  const keepDrawn = createLiftMotion(container, lifted);
  const collapsed = rail.collapsed;
  const topology = rail.topology;
  const presentSections = createMemo(() => sections.filter(section => topology().section.includes(section.id)));

  /** U3800d: a row the move left as it was keeps its object, so the view built from it does not run again. */
  const stable = (previous: Map<string, RailRow> | undefined, row: RailRow): RailRow => {
    const kept = previous?.get(row.key);

    return kept && sameRow(kept, row) ? kept : row;
  };

  const sectionRows = createMemo<{ id: RailSection; label: string; icon: (typeof sections)[number]["icon"]; rows: RailRow[] }[]>(() => presentSections().map(section => ({
    ...section,
    rows: rail.closedSections().has(section.id) ? [] : layoutRail(topology(), { collapsed: lifted() === null ? collapsed() : new Set([...collapsed(), lifted()!]), unfolded: unfolded(), now: now(), selected: rail.selected() }, section.id),
  })));

  const rows = createMemo<RailRow[]>(previous => {
    const before = new Map(previous?.map(row => [row.key, row]));

    return sectionRows().flatMap(section => section.rows).map(row => stable(before, row));
  });

  const signatures = new WeakMap<object, string>();
  const shown = new WeakMap<object, ReadonlySet<string>>();

  // Solid 2's `createDeferred` lags only an async answer; a sync source it serves at once, so the task's wait is a debounce.
  const [lagging, setLagging] = createSignal(untrack(topology));
  const catchUp = debounce((next: ReturnType<typeof topology>) => setLagging(next), 0);

  createEffect(topology, next => { catchUp(next); });

  const [keyed, setKeyed] = createSignal<object | null>(null);

  /** Builds the items now when a redraw put it off, so a key pressed before that task walks the rows as they show. */
  const settleItems = () => {
    setKeyed(topology());
    flush();
  };

  /** The values of the sections and rows the Rail shows now. */
  const showing = (): ReadonlySet<string> => new Set([...presentSections().map(section => `section:${section.id}`), ...rows().map(row => row.kind === "node" ? row.node.id : row.key)]);

  /** A redraw that shows the very rows `previous` was last drawn with, in any order, puts its rebuild off a task, unless a key press asked for it first. */
  const putOff = (previous: TreeItemData[] | undefined, live: ReadonlySet<string>): previous is TreeItemData[] => {
    const drawn = previous && shown.get(previous);

    if (!drawn || lagging() === topology() || keyed() === topology()) return false;

    return drawn.size === live.size && [...live].every(value => drawn.has(value));
  };

  /**
   * Section items share the tree's keyboard walk and add one semantic level above their rows.
   * U3800g: a move shows the same rows in a new order, so the items are rebuilt a task after the redraw: the tree's shape for every row is the larger part of that redraw.
   * A redraw that shows a row more or a row fewer, as an add, a removal or a fold that opens or closes does, is built at once, and so is the tree a key press finds (`settleItems`).
   * A move that leaves the tree's signature as it was keeps the items, so the tree does not recompute its shape.
   */
  const items = createMemo<TreeItemData[]>(previous => {
    const live = showing();

    if (putOff(previous, live)) return previous;

    const allUnfolded = new Set([...topology().index.keys()].flatMap(id => [id, `internal:${id}`]));
    const selected = rail.selected();
    const chosen = selected === null ? undefined : topology().nodes[topology().index.get(selected) ?? -1];
    const parent = chosen?.parent == null ? undefined : topology().nodes[topology().index.get(chosen.parent) ?? -1];
    const foldId = chosen && parent ? foldIdOf(chosen, parent.id, { collapsed: collapsed(), unfolded: unfolded(), now: now() }) : null;

    // U6238a: a closed fold lifts the selected Agent, so the items hold it beside its siblings, as the rows do.
    if (foldId !== null && !unfolded().has(foldId)) allUnfolded.delete(foldId);

    const next = presentSections().map(section => ({
      value: `section:${section.id}`, label: section.label,
      children: railItems(layoutRail(topology(), { collapsed: new Set(), unfolded: allUnfolded, now: now(), selected }, section.id)),
    }));

    const signature = JSON.stringify(next);

    if (previous && signatures.get(previous) === signature) {
      shown.set(previous, live);

      return previous;
    }

    signatures.set(next, signature);
    shown.set(next, live);

    return next;
  });

  const branches = createMemo<ReadonlySet<string>>(() => new Set(branchesOf(items())));

  const expanded = createMemo<string[]>(() => branchesOf(items()).filter(id => {
    const section = sections.find(section => `section:${section.id}` === id);

    return section ? !rail.closedSections().has(section.id) : id.startsWith("fold:") ? unfolded().has(id.slice(5)) : !collapsed().has(id);
  }), { equals: sameList });

  const nodeRows = createMemo(() => rows().filter((row): row is NodeRow => row.kind === "node"));
  const nodeIds = createMemo(() => nodeRows().map((row) => row.node.id));
  const indexOf = createMemo(() => new Map(nodeIds().map((id, at) => [id, at])));
  const treeRows = createMemo(() => nodeRows().map((row) => ({ id: row.node.id, parent: topology().nodes[topology().parent[topology().index.get(row.node.id)!] ?? -1]?.id ?? null })));
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));

  // Built on the first drop asked about after a move landed: the topology is a new object whenever a node's parent changes.
  let placed: { from: ReturnType<typeof topology>; map: Map<string, { id: string; kind: ProjectNode["kind"]; parent: string | null }> } | undefined;

  const placeNodes = () => {
    if (placed?.from !== topology()) placed = { from: topology(), map: new Map(rail.nodes.map((node) => [node.id, { id: node.id, kind: node.kind, parent: node.parent }])) };

    return placed.map;
  };

  /** What a drag asks of the Rail: which rows nest a child, the Daemon's placement rule for the drops it may show (U6550c), and the fold of the row it holds. */
  const dropRules = {
    nests: (id: string) => rows().some((row) => row.kind === "node" && row.node.id === id && isWorkstream(row.node) && row.collapsed === null),
    takes: (id: string, parent: string | null) => placeable(placeNodes(), id, parent),
    onLift: (id: string | null, keyboard = false) => { keepDrawn(keyboard); setLifted(id); },
  };

  return { topology, sectionRows, rows, items, settleItems, branches, expanded, nodeRows, nodeIds, indexOf, treeRows, byKey, lifted, dropRules };
};
