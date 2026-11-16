import type { Size, TerminalPreparation } from "../terminal/emulator";
import { captureFocus } from "../keys/focus";
import { askOnce } from "../settings/warnings";
import { createItemFailure } from "./itemFailure";
import { copy } from "./copy";
import { saveViewer, viewer } from "../resize/viewer";
import { applying } from "../app/pending";
import PQueue from "p-queue";
import { createEffect, createMemo, createRoot, createSignal, flush, latest, onCleanup, createStore, reconcile, snapshot, untrack } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { Status } from "@contracts/Status";
import type { RailNode } from "@contracts/agent/RailNode";
import type { StatusEvent } from "@contracts/agent/StatusEvent";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { attemptAfter, doorAttempt, doorTerminalId, isDoor, type DoorNode } from "./doorNode";
import { defaultWorkstreamName } from "./defaultName";
import { railTopology, type RailTopology } from "./railTopology";
import { ancestorsOf, isWorkstream } from "./railTopology";
import type { RailSection, RailStorage, ResumptionStorage } from "./railStorage";
import { handleEvent, type EventHandlers, type Events } from "../app/events";
import { outcomeOf, type AppSeam } from "../app/seam";

/** How an exited node's program ended: with a code, by a signal, or unknown because the node has no Terminal. */
export type ExitState = { kind: "code"; code: number } | { kind: "signal" } | { kind: "unknown" };

const isTerminal = (item: RailNode | TerminalInfo): item is TerminalInfo => "incarnation" in item;

/** U5151c: one failure, bound to its Attempt and Status revision. U7189: a Terminal's status, bound to the Terminal and the time its Kind last changed, so a new status needs the owner again. */
const failureKey = (item: RailNode | TerminalInfo): string | null => {
  if (isTerminal(item)) return item.status ? `terminal:${item.incarnation}:${item.status.since}` : null;

  return isDoor(item) && item.status?.kind === "error" && item.attempt !== null && item.status_revision !== null ? `${item.id}:${item.attempt}:${item.status_revision}` : null;
};

export type DismissalStorage = {
  read(): string[] | null;
  write(keys: string[]): Promise<string | null>;
};

export type RailState = {
  /** U5151c: whether the owner dismissed this node's current failure. U7189: whether the owner has seen this Terminal's current status. */
  dismissed(item: RailNode | TerminalInfo): boolean;
  /** U5151c: acknowledge this node's current failure; sends nothing to the Agent. U7189: the owner has seen this Terminal's status. */
  dismiss(item: RailNode | TerminalInfo): void;
  prepareTerminal?: (() => Promise<TerminalPreparation | undefined>) | undefined;
  commandFailure: ReturnType<typeof createItemFailure>;
  /** Rows in the Daemon's order; only a `rail.tree` call adds or removes one. */
  readonly nodes: readonly RailNode[];
  /** U5991a: take rows off the Rail at once; the returned call lifts the pending change, returning whatever the Daemon still holds. */
  hide(ids: readonly string[]): () => void;
  /** U5991a: the Daemon applied the move of Row `id`; the tree holds it before the pending change lifts. */
  keepApplied(id: string, place: RailPlace): void;
  /** U5991a: show Row `id`'s program as stopped (`exit`) or running (`null`) at once; the returned call lifts it. */
  drawExit(id: string, exit: ExitState | null): () => void;
  /** U5991a: show a new Row of `kind` named `name` under `parent` at once; the returned call lifts it once the refreshed tree holds the Daemon's Row. */
  drawNew(kind: "agent" | "workstream", name: string, parent: string | null): () => void;
  /** U5991a: show Rows `ids` grouped under a new Workstream at the first one's place at once. */
  drawGroup(ids: readonly string[], name: string): () => void;
  /** U5991a: remember the Rows `ids` that a removal took, as they stood, for the undo that returns them. */
  keepRemoved(ids: readonly string[]): void;
  /** U5991a: show the last removal undone (`undo`) or redone at once; the returned call refreshes, then lifts the pending change; `kept` false puts the memory back, since the call failed. */
  drawHistory(direction: "undo" | "redo"): (kept: boolean) => Promise<void>;
  /** U5991a: show `change` of the tree at once; the returned call lifts it once the Daemon's reply or Event holds the result. U5991f: a `change` that adds a Row names it in `landing`, and the pending change stands down the moment the tree holds a Row that arrived since, so no frame shows both. */
  draw(change: (tree: readonly RailNode[]) => readonly RailNode[], landing?: Landing): () => void;
  /** One structural index shared by selection and every mounted Rail projection. */
  topology(): RailTopology;
  /** U5483c: latest accepted working start in milliseconds; retained across Project connections for the same Attempt. */
  resumedAt(id: string): number | undefined;
  /** `null` while the node's program runs, and for a Workstream (one with no program). */
  exitOf(node: RailNode): ExitState | null;
  /** X11, X12: every Terminal the Daemon lists, as of the last `terminal.list`. */
  terminals(): readonly TerminalInfo[];
  /** How Terminal `id` ended, or `null` while it runs or when it is unknown. */
  terminalExit(id: string): ExitState | null;
  /** U6000a: show row `id` as `starting` until the returned call lifts the pending change. */
  launch(id: string): () => void;
  /** U6000a: true while a launch holds row `id` at `starting`; a pending `rail.startDoor` is one. */
  launching(id: string): boolean;
  /** True while a `rail.startDoor` call for Workstream `id` is pending. */
  doorPending(id: string): boolean;
  doorFailure(id: string): string | null;
  startDoor(id: string): Promise<void>;
  /** DCL1a: asks the Daemon for one delivery pass for Agent `id`; resolves `null` once it ran, else the failure message. */
  retryDelivery(id: string): Promise<string | null>;
  /** U6248c: send the resume Message to an Agent whose resumes ran out. */
  resumeTurn(id: string): Promise<string | null>;
  /** U9/U62: creates a root Workstream, then selects it and starts its Door once `rail.tree` returns it. */
  createWorkstream(): Promise<void>;
  /** U5241: creates a root Workstream named `name`; resolves `null` once the Daemon made it, else the failure message, shown nowhere on the Rail. */
  createNamedWorkstream(name: string): Promise<string | null>;
  /** True from the click until the new Workstream has appeared and its Door launch has begun. */
  workstreamCreating(): boolean;
  clearWorkstreamFailure(): void;
  selected(): string | null;
  /** One initial Terminal focus permission, captured on creation, selection or an explicit supervisor start. */
  terminalFocus(): ReturnType<typeof captureFocus>;
  restored(): boolean;
  collapsed(): ReadonlySet<string>;
  closedSections(): ReadonlySet<RailSection>;
  setSectionOpen(section: RailSection, open: boolean): void;
  toggleCollapsed(id: string): void;
  storageFailure(): string | null;
  clearStorageFailure(): void;
  /** U5151e: the Agent whose dismissal the storage rejected, until a Retry saves it or the owner dismisses the line. */
  unsavedDismissal(): string | null;
  retryDismissal(): void;
  clearUnsavedDismissal(): void;
  select(id: string | null, intent?: "open", focus?: ReturnType<typeof captureFocus>): void;
  /** Whether showing the selection acknowledges its Agent’s alerts. */
  shouldAcknowledgeAlerts(): boolean;
  nameOf(actor: Actor): string;
  /** U5172a: the change asked of Row `id` that the Daemon has not yet confirmed, or `null`. */
  pendingOf(id: string): PendingChange | null;
  /** U5172a: keeps the asked change on Row `id`, marked, until an Event or a re-read settles it. */
  keepAsked(id: string, change: PendingChange): void;
  /** U5172a: where Row `id` sits now. */
  placeOf(id: string): RailPlace | null;
  /** U5172a: renames Row `id`; a refusal throws, an unanswered call keeps `name` marked as unconfirmed. */
  rename(id: string, name: string): Promise<void>;
  /** The message of the last failed fetch, until a later fetch succeeds. */
  failure(): string | null;
  /** Fetches the current tree after a write found that its row had already gone; `terminals` also refetches `terminal.list`, so a missed exit shows. Resolves once that fetch and the Events queued before it applied. */
  refresh(options?: { terminals?: boolean }): Promise<void>;
  /** Resolves once the Rail shows only what the Daemon holds: no fetch is in flight, no Event waits to apply and no pending change waits on its call. */
  settled(): Promise<void>;
};

/** U5172a: a change the App asked and the Daemon has not answered. A rename shows `asked` over the `base` name. */
export type PendingChange = { kind: "rename"; asked: string; base: string } | { kind: "remove" } | { kind: "move"; asked: RailPlace; base: RailPlace };

/** U5172a: where a Row sits: its parent and its index among that parent's children. */
export type RailPlace = { parent: string | null; index: number };

const placeOf = (tree: readonly RailNode[], id: string): RailPlace | null => {
  const node = tree.find(each => each.id === id);

  return node === undefined ? null : { parent: node.parent, index: tree.filter(each => each.parent === node.parent).findIndex(each => each.id === id) };
};

/** U5172a: `tree` with Row `id` put at `place`: before the child of `place.parent` now at that index, else after the parent's last child (or its parent Row). */
export const movedTo = (tree: readonly RailNode[], id: string, place: RailPlace): RailNode[] => {
  const node = tree.find(each => each.id === id);

  if (node === undefined) return [...tree];
  const rest = tree.filter(each => each.id !== id);
  const siblings = rest.filter(each => each.parent === place.parent);
  const before = siblings[place.index];
  const last = siblings.at(-1);
  const at = before !== undefined ? rest.indexOf(before) : last !== undefined ? rest.indexOf(last) + 1 : place.parent === null ? rest.length : rest.findIndex(each => each.id === place.parent) + 1;

  const moved = [...rest.slice(0, at), { ...node, parent: place.parent }, ...rest.slice(at)];
  // Siblings show in `order`, so the new sequence renumbers it.
  const sequence = moved.flatMap(each => each.parent === place.parent ? [each.id] : []);

  // U3800d: a sibling whose number is unchanged stays the same object, so the Rail redraws only what the move changed.
  return moved.map(each => each.parent === place.parent && each.order !== sequence.indexOf(each.id) ? { ...each, order: sequence.indexOf(each.id) } : each);
};

/** The Daemon's own `starting` Status, drawn before it reports one. */
const startingStatus = (since: number | undefined): Status => ({ kind: "working", label: "starting", since: since ?? Date.now(), finished: "0" });

/** A24: how long the App waits for `rail.startDoor`, the Daemon's own bound of 10 000 ms. */
const DOOR_START_BOUND_MS = 10_000;

const once = (run: () => void): (() => void) => {
  let done = false;

  return () => {
    if (done) return;
    done = true;
    run();
  };
};

let provisionalCount = 0;

const PROVISIONAL = "provisional-";

/** U5991a: whether `node` is a drawn Row that the Daemon does not hold yet. */
export const isProvisional = (node: RailNode): boolean => node.id.startsWith(PROVISIONAL);

/** U5991a: the Row a new Agent or Workstream shows until the Daemon's own arrives; it carries no Terminal. */
const provisionalRow = (tree: readonly RailNode[], kind: "agent" | "workstream", name: string, parent: string | null): DoorNode => {
  const door = {
    id: `${PROVISIONAL}${++provisionalCount}`,
    name,
    parent,
    order: tree.reduce((next, each) => each.parent === parent ? Math.max(next, each.order + 1) : next, 0),
    status: { kind: "working", label: "starting", since: Date.now(), finished: "0" } satisfies Status,
    attempt: null,
    status_revision: null,
    terminal_id: null,
    worktree: null,
    can_resume: false, has_conversation: false, yolo: false,
    channel: null,
    stray: [],
    model: null,
    effort: null,
    work: null,
  };

  return kind === "agent" ? { ...door, kind, can_make_workstream: false, can_save_as_mode: false } : { ...door, kind, auto: false };
};

/** U5991f: the Row a pending change adds, as the Daemon's own Row will arrive: of `kind`, under `parent`, with an id not in `known`. */
type Landing = { kind: RailNode["kind"]; parent: string | null };

/** U5991a, U6000a: one change the Rail shows before the Daemon confirms it, until its lift runs: Rows taken off, a change of the tree, or a Row shown starting. */
type Pending =
  | { kind: "hide"; ids: readonly string[] }
  | { kind: "draw"; change: (tree: readonly RailNode[]) => readonly RailNode[]; landing?: (Landing & { known: ReadonlySet<string> }) | undefined }
  | { kind: "launch"; id: string };

/** The Rail as shown: `tree` without hidden Rows, with each drawn change in order, and launched Rows `starting`. U5991f: a Row-adding change claims the oldest Row the Daemon added since it was drawn and, having one, changes nothing, so no frame shows both. */
const shownOver = (tree: readonly RailNode[], pending: readonly Pending[]): readonly RailNode[] => {
  const hidden = new Set(pending.flatMap(each => each.kind === "hide" ? each.ids : []));
  const starting = new Set(pending.flatMap(each => each.kind === "launch" ? [each.id] : []));
  const claimed = new Set<string>();
  const shown = hidden.size === 0 ? tree : tree.filter(node => !hidden.has(node.id));

  const drawn = pending.reduce((rows, each) => {
    if (each.kind !== "draw") return rows;
    const { landing } = each;
    const arrived = landing && shown.find(node => !landing.known.has(node.id) && !claimed.has(node.id) && node.kind === landing.kind && node.parent === landing.parent);

    if (arrived) claimed.add(arrived.id);

    return arrived ? rows : each.change(rows);
  }, shown);

  return starting.size === 0 ? drawn : drawn.map(node => starting.has(node.id) && isDoor(node) ? { ...node, status: startingStatus(node.status?.since) } : node);
};

type Resumed = Parameters<ResumptionStorage["write"]>[0];

/** U5483c: when each Door's current Attempt last started working, from `stored` and kept up to date. */
const createResumed = (stored: Resumed) => {
  const [resumed, setResumed] = createStore<Resumed>(stored);

  /** Notes the node's working start; false when the node is no working Door or that start is already noted. */
  const record = (node: RailNode): boolean => {
    if (!isDoor(node) || node.status?.kind !== "working" || (resumed[node.id]?.attempt === node.attempt && resumed[node.id]?.since === node.status.since)) return false;
    const noted = { attempt: node.attempt, since: node.status.since };

    setResumed(draft => { draft[node.id] = noted; });

    return true;
  };

  /** Forgets each Door the tree no longer holds at its noted Attempt, and notes every working start; true when any note changed. */
  const sync = (tree: readonly RailNode[]): boolean => {
    const gone = Object.keys(resumed).filter(id => !tree.some(node => node.id === id && isDoor(node) && node.attempt === resumed[id]?.attempt));

    for (const id of gone) setResumed(draft => { delete draft[id]; });

    return tree.filter(record).length > 0 || gone.length > 0;
  };

  return { resumed, record, sync };
};

/** `tree` with each unconfirmed rename's asked name and each unconfirmed move drawn on it. */
const withAsked = (tree: readonly RailNode[], asked: Readonly<Record<string, PendingChange>>): RailNode[] => {
  const renamed = tree.map(node => {
    const change = asked[node.id];

    return change?.kind === "rename" ? { ...node, name: change.asked } : node;
  });

  return Object.entries(asked).reduce((shown, [id, change]) => change.kind === "move" ? movedTo(shown, id, change.asked) : shown, renamed);
};

/** Writes a Door's reported status onto its row, unless the row already holds a newer one. */
const applyStatus = (tree: RailNode[], reported: StatusEvent) => {
  for (const row of tree) {
    if (isDoor(row) && row.id === reported.id && row.attempt === reported.attempt && row.status_revision !== null && BigInt(reported.status_revision) > BigInt(row.status_revision)) {
      row.status = reported.status;
      row.status_revision = reported.status_revision;
    }
  }
};

/** `listed` with Terminal `id` showing `status`, or none when `status` is empty. */
const withTerminalStatus = (listed: readonly TerminalInfo[], id: string, status: TerminalInfo["status"] | null): TerminalInfo[] => listed.map(terminal => {
  if (terminal.id !== id) return terminal;

  const { status: _previous, ...rest } = terminal;

  return status ? { ...rest, status } : rest;
});

export const createRailState = (app: AppSeam, events: Events, storage?: RailStorage, dismissals?: DismissalStorage, resumptions?: ResumptionStorage): RailState => {
  const [model, setModel] = createStore<{ tree: RailNode[]; exited: Record<string, number | null> }>({
    tree: [],
    exited: {},
  });

  // U5991a, U6000a: what Rail actions show before their calls answer; each lift takes its own change off.
  const [pending, setPending] = createSignal<readonly Pending[]>([]);

  const show = (change: Pending): (() => void) => {
    setPending(each => [...each, change]);

    return once(() => setPending(each => each.filter(other => other !== change)));
  };

  const removedRows: RailNode[][] = [];
  const redoneRows: RailNode[][] = [];
  const renaming = new Map<string, () => void>();
  const [exitsDrawn, setExitsDrawn] = createSignal<ReadonlyMap<string, { exit: ExitState | null }>>(new Map());

  // Solid tracks membership and structural fields, including reconciled in-place edits.
  // Status, selection, disclosure, questions and clocks never enter this memo.
  const view = createMemo(() => shownOver(model.tree, pending()));

  const topology = createMemo(() => railTopology(view()));

  const { resumed, record: recordResumption, sync: syncResumptions } = createResumed(resumptions?.read() ?? {});

  const [doors, setDoors] = createStore<Record<string, { pending: boolean; observedLive: boolean; failure: { message: string; attempt: string | null } | null }>>({});
  const [terminals, setTerminals] = createSignal<readonly TerminalInfo[]>([]);
  const commandFailure = createItemFailure(id => model.tree.some(node => node.id === id), terminals);
  const [dismissedKeys, setDismissedKeys] = createSignal<ReadonlySet<string>>(new Set(dismissals?.read() ?? []));
  const [selected, setSelected] = createSignal<string | null>(null);
  const openingFocus = captureFocus();
  const [terminalFocus, setTerminalFocus] = createSignal(() => openingFocus);
  const [selectionIntent, setSelectionIntent] = createSignal<"select" | "open">("select");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [workstreamCreating, setWorkstreamCreating] = createSignal(false);
  /** The id `rail.createWorkstream` returned, until `rail.tree` shows its row. */
  let wantedWorkstream: string | null = null;
  let workstreamUnknown: string | null = null;
  let workstreamFocus = captureFocus();
  let selectionRevision = 0;
  let workstreamSelection = 0;

  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const closedSections = createMemo((): ReadonlySet<RailSection> => new Set(viewer().sections));
  const [restored, setRestored] = createSignal(false);
  const [storageFailure, setStorageFailure] = createSignal<string | null>(null);
  // U5151g: one entry per failure whose dismissal write was refused; the Rail shows the oldest.
  const [unsaved, setUnsaved] = createSignal<{ key: string; name: string }[]>([]);
  let firstTree = true;

  const save = async (layout: Parameters<RailStorage["write"]>[0]) => {
    setStorageFailure(await storage?.write(layout) ?? null);
  };

  const saveResumptions = async () => {
    setStorageFailure(await resumptions?.write({ ...snapshot(resumed) }) ?? null);
  };

  /** Opens the Workstreams above `id`, and returns the set the Rail now holds collapsed. */
  const reveal = (id: string | null): ReadonlySet<string> => {
    const above = new Set(id === null ? [] : ancestorsOf(topology(), id));

    return setCollapsed((closed) => id === null ? closed : new Set([...closed].filter((workstream) => !above.has(workstream))));
  };

  const [unconfirmed, setAsked] = createStore<Record<string, PendingChange>>({});

  /** U5172a: a read or Event settles an unconfirmed change: confirmed clears the mark, a contradicting name shows the Daemon's with one failure, an unchanged row stays marked. */
  const reconcileAsked = (tree: readonly RailNode[]) => {
    for (const [id, change] of Object.entries(unconfirmed)) {
      const node = tree.find(each => each.id === id);

      if (node === undefined) {
        setAsked(draft => { delete draft[id]; });
        continue;
      }

      if (change.kind === "move") {
        const place = placeOf(tree, id)!;

        if (place.parent === change.base.parent && place.index === change.base.index) continue;
        setAsked(draft => { delete draft[id]; });

        if (place.parent !== change.asked.parent || place.index !== change.asked.index) commandFailure.show(copy.moveDidNotApply, id, "rail");
        continue;
      }

      if (change.kind !== "rename" || node.name === change.base) continue;
      setAsked(draft => { delete draft[id]; });

      if (node.name !== change.asked) commandFailure.show(copy.renameDidNotApply(change.asked, node.name), id, "rail");
    }
  };

  /** Fetches run one after another, and Events that arrive meanwhile wait behind them: the answer may predate them. */
  const queue = new PQueue({ concurrency: 1 });
  // The queue starts an idle job in its caller's turn, and the first fetch is asked from the owned setup.
  const [fetchingNow, setFetchingNow] = createSignal(false, { ownedWrite: true });

  queue.on("active", () => setFetchingNow(true));
  queue.on("idle", () => setFetchingNow(false));

  const select = (id: string | null, focus = captureFocus(true), intent?: "open"): void => {
    selectionRevision++;
    // A refresh may have written the tree while async work still holds the write back: `latest` sees the row `refresh` just fetched.
    const next = id !== null && latest(() => model.tree.some((node) => node.id === id)) ? id : null;

    setTerminalFocus(() => focus);
    setSelectionIntent(intent ?? "select");
    setRestored(false);
    setSelected(next);
    save({ selected: next, collapsed: [...reveal(next)] });
  };

  const hasLiveTerminal = (node: RailNode) => isDoor(node) && node.terminal_id !== null && !(node.terminal_id in model.exited);

  const fetchTree = async () => {
    const tree = await app.rpc("rail.tree", null);

    reconcileAsked(tree);
    // The asked changes as reconcileAsked left them.
    setModel(draft => { reconcile(withAsked(tree, snapshot(unconfirmed)), "id")(draft.tree); });
    const resumptionChanged = syncResumptions(tree);

    settleDoors(tree);
    settleSelection(tree);

    if (resumptionChanged) await saveResumptions();

    flush(); // TEMP-WAVE2B
    openWanted(tree);
  };

  /** A Door showing a live Terminal has started: its pending start was observed live, and a failure it had is over. */
  const settleDoors = (tree: readonly RailNode[]) => {
    for (const node of tree) {
      if (doors[node.id]?.pending && hasLiveTerminal(node)) setDoors(draft => { draft[node.id]!.observedLive = true; });
      const failed = doors[node.id]?.failure;

      if (failed && (hasLiveTerminal(node) || attemptAfter(node, failed.attempt))) {
        setDoors(draft => { draft[node.id]!.failure = null; });
        commandFailure.acknowledge(node.id);
      }
    }
  };

  /** The first tree restores the saved selection and folds; a later one clears a selection whose row is gone. */
  const settleSelection = (tree: readonly RailNode[]) => {
    if (firstTree) {
      firstTree = false;
      const saved = storage?.read();

      if (saved) {
        const chosen = tree.some((node) => node.id === saved.selected) ? saved.selected : null;

        // Revealing reads the topology of the tree just written, before the selection is.
        flush();
        setSelected(chosen);
        setCollapsed(new Set(saved.collapsed.filter((id) => tree.some((node) => node.id === id && (isWorkstream(node) || node.kind === "group")))));
        setRestored(chosen !== null);
        save({ selected: chosen, collapsed: [...reveal(chosen)] });
      }
    } else {
      const id = selected();

      if (id !== null && !tree.some((node) => node.id === id)) {
        setSelected(null);
        save({ selected: null, collapsed: [...collapsed()] });
      }
    }
  };

  /** Once the tree holds the Workstream just created, select it and start its Door. */
  const openWanted = (tree: readonly RailNode[]) => {
    const wanted = wantedWorkstream;

    if (wanted !== null && tree.some((node) => node.id === wanted)) {
      wantedWorkstream = null;

      if (selectionRevision === workstreamSelection) select(wanted, workstreamFocus);

      // The Door's start reads the selection just written to decide whether to prepare the shown Terminal's size.
      flush();
      setWorkstreamCreating(false);
      void startDoor(wanted, false);
    }
  };

  const fetchTerminals = async () => {
    const listed = await app.rpc("terminal.list", null);

    setTerminals(listed);

    setModel(draft => {
      for (const terminal of listed) {
        if (!terminal.running) draft.exited[terminal.id] = terminal.exit_code;
      }
    });
  };

  /** U3703: select the Agent that owns Terminal `id` (its own, or the Bubble's owner); an unknown id or an owner with no row changes nothing. */
  const showTerminal = (id: string): void => {
    const owner = model.tree.find((node) => isDoor(node) && node.terminal_id === id)?.id ?? terminals().find((terminal) => terminal.id === id)?.owner;

    if (owner && owner !== selected() && model.tree.some((node) => node.id === owner)) select(owner);
  };

  const fetching = (work: () => Promise<void>): Promise<void> => queue.add(async () => {
    try {
      await work();
      setFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      setFailure(error.message);
    }
  });

  const handlers: EventHandlers = {
    "rail.changed": () => void fetching(fetchTree),
    "rail.renamed": ({ data }) => {
      const row = model.tree.find(node => node.id === data.id);

      if (row !== undefined) reconcileAsked([{ ...row, name: data.name }]);
      setModel(draft => { for (const node of draft.tree) if (node.id === data.id) node.name = data.name; });
    },
    "agent.status": ({ data }) => {
      // SAFETY: the updater below assigns it; flow analysis does not follow an assignment made inside a callback.
      let node = undefined as RailNode | undefined;

      setModel(draft => {
        applyStatus(draft.tree, data);

        // The write has not landed in `model` yet; the resumption check reads the Row as this write leaves it.
        const written = draft.tree.find(row => row.id === data.id);

        node = written && snapshot(written);
      });

      if (node && recordResumption(node)) void saveResumptions();
    },
    "agent.toolCall": ({ data }) => setModel(draft => { for (const node of draft.tree) if (node.id === data.id && isDoor(node)) node.tool_call = data.call; }),
    "terminal.changed": () => void fetching(fetchTerminals),
    "terminal.shown": ({ data }) => showTerminal(data.id),
    "terminal.status": ({ data: { id, status } }) => setTerminals(listed => withTerminalStatus(listed, id, status)),
    "terminal.exited": ({ data }) => setModel(draft => { draft.exited[data.id] = data.code; }),
  };

  /** A24: the call's answer, or a rejection once `DOOR_START_BOUND_MS` passes without one. */
  const boundedStart = (id: string, size?: Size): Promise<RailNode> => {
    const { promise: expiry, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(() => reject(new Error(copy.theDoorDidNotStartInTimeRetry)), DOOR_START_BOUND_MS);

    return Promise.race([app.rpc("rail.startDoor", { id, ...size }), expiry]).finally(() => clearTimeout(timer));
  };

  const startDoor = async (id: string, focus = true): Promise<void> => {
    if (doors[id]?.pending) return;

    if (focus && selected() === id) {
      setTerminalFocus(() => captureFocus(true));
      setRestored(false);
    }

    setDoors(draft => { draft[id] = { pending: true, observedLive: false, failure: null }; });
    const release = state.launch(id);

    let prepared: TerminalPreparation | undefined;

    try {
      if (selected() === id) prepared = await state.prepareTerminal?.();
      const node = await boundedStart(id, prepared?.size);

      if (doorTerminalId(node)) prepared?.bind(doorTerminalId(node)!);
      commandFailure.acknowledge(id);
      await fetching(fetchTree);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      await fetching(fetchTree);
      const node = model.tree.find((each) => each.id === id);

      if (node && !hasLiveTerminal(node) && !doors[id]?.observedLive) {
        setDoors(draft => { draft[id]!.failure = { message: error.message, attempt: doorAttempt(node) }; });
        commandFailure.show(error.message, id, "pane");
      }
    } finally {
      prepared?.dispose();
      setDoors(draft => { draft[id]!.pending = false; });
      release();
    }
  };

  /** `named` is a Switcher's create (U5241): its failure goes back to the caller, not to the Rail's line. */
  const makeWorkstream = (named: string | null): Promise<string | null> => {
    const params = { name: named ?? defaultWorkstreamName(model.tree), parent: null };

    // The connection and these arguments outlive the Rail that offered the action.
    const create = async (): Promise<string | null> => {
      if (workstreamCreating()) return null;
      setWorkstreamCreating(true);
      // U5991a: the Row shows now; the refreshed tree or a failure lifts it.
      const lift = state.drawNew("workstream", params.name, null);

      try {
        if (workstreamUnknown !== null && !await askOnce(app, "new-workstream-again", { title: copy.newWorkstreamTitle, message: `${copy.terminalOutcomeUnknown}${workstreamUnknown}`, okLabel: copy.newWorkstreamTitle, cancelLabel: copy.keep })) return workstreamUnknown;

        workstreamFocus = captureFocus(true);
        workstreamSelection = selectionRevision;
        wantedWorkstream = (await app.rpc("rail.createWorkstream", params)).id;
        workstreamUnknown = null;
        commandFailure.acknowledge(null);
        await state.refresh();

        return null;
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        workstreamUnknown = outcomeOf(error) === "unknown" ? error.message : null;

        if (named !== null) return error.message;
        commandFailure.show(`${copy.newWorkstreamTitle}: ${workstreamUnknown !== null ? copy.terminalOutcomeUnknown : ""}${error.message}`, null, "rail", () => { void create(); });

        return error.message;
      } finally {
        lift();

        if (wantedWorkstream === null) setWorkstreamCreating(false);
      }
    };

    return create();
  };

  const createWorkstream = async (): Promise<void> => { await makeWorkstream(null); };

  // An Event waits while the queue is busy, so none overtakes a fetch asked before it.
  onCleanup(events.subscribe((event) => {
    if (queue.size + queue.pending === 0) handleEvent(handlers, event);
    else void queue.add(() => handleEvent(handlers, event));
  }));
  const fetchAll = async (): Promise<void> => { await Promise.all([fetchTree(), fetchTerminals()]); };

  void untrack(() => fetching(fetchAll));

  const state: RailState = {
    resumedAt: id => resumed[id]?.since,
    commandFailure,
    terminals,
    terminalExit: (id) => {
      if (!(id in model.exited)) return null;

      const code = model.exited[id] ?? null;

      return code === null ? { kind: "signal" } : { kind: "code", code };
    },
    launch: id => show({ kind: "launch", id }),
    launching: id => pending().some(each => each.kind === "launch" && each.id === id),
    doorPending: (id) => doors[id]?.pending ?? false,
    doorFailure: (id) => doors[id]?.failure?.message ?? null,
    startDoor,
    resumeTurn: id => app.rpc("message.send", { to: id, kind: "note", body: copy.resumeNote, replyTo: null }).then(() => null, (error: Error) => error.message),
    retryDelivery: id => app.rpc("message.retryDelivery", { id }).then(() => null, (error: Error) => error.message),
    createWorkstream,
    createNamedWorkstream: name => makeWorkstream(name),
    workstreamCreating,
    clearWorkstreamFailure: () => commandFailure.acknowledge(null),
    topology,
    get nodes() {
      return view();
    },
    hide: ids => show({ kind: "hide", ids }),
    draw: (change, landing) => show({ kind: "draw", change, landing: landing && { ...landing, known: new Set(model.tree.map(node => node.id)) } }),
    keepRemoved: ids => {
      const rows = model.tree.filter(node => ids.includes(node.id)).map(node => ({ ...node }));

      if (rows.length > 0) removedRows.push(rows);
    },
    drawHistory: direction => {
      const [from, to] = direction === "undo" ? [removedRows, redoneRows] : [redoneRows, removedRows];
      const rows = from.pop();

      if (rows === undefined) return async () => undefined;
      to.push(rows);

      const lift = state.draw(tree => {
        const kept = tree.filter(node => !rows.some(row => row.id === node.id));

        return direction === "undo" ? [...kept, ...rows] : kept;
      });

      return async kept => {
        if (!kept) { to.pop(); from.push(rows); }

        try { await state.refresh(); } finally { lift(); }
      };
    },
    drawNew: (kind, name, parent) => state.draw(tree => [...tree, provisionalRow(tree, kind, name, parent)], { kind, parent }),
    drawGroup: (ids, name) => state.draw(tree => {
      const first = tree.find(each => ids.includes(each.id));
      const row = { ...provisionalRow(tree, "workstream", name, first?.parent ?? null), order: first?.order ?? 0 };

      return [...tree.map(each => ids.includes(each.id) ? { ...each, parent: row.id } : each), row];
    }, { kind: "workstream", parent: model.tree.find(each => ids.includes(each.id))?.parent ?? null }),
    drawExit: (id, exit) => {
      const mark = { exit };

      setExitsDrawn(marks => new Map(marks).set(id, mark));

      return () => setExitsDrawn(marks => marks.get(id) !== mark ? marks : new Map([...marks].filter(([key]) => key !== id)));
    },
    keepApplied: (id, place) => setModel(draft => { reconcile(movedTo(snapshot(model.tree), id, place), "id")(draft.tree); }),
    exitOf: (node) => {
      const drawnExit = exitsDrawn().get(node.id);

      if (drawnExit !== undefined) return drawnExit.exit;

      if (!isDoor(node) || node.terminal_id === null) return { kind: "unknown" };

      if (!(node.terminal_id in model.exited)) return null;

      const code = model.exited[node.terminal_id] ?? null;

      return code === null ? { kind: "signal" } : { kind: "code", code };
    },
    pendingOf: (id) => unconfirmed[id] ?? null,
    placeOf: (id) => placeOf(model.tree, id),
    rename: async (id, name) => {
      const base = model.tree.find(node => node.id === id)?.name ?? "";
      // The newest name asked is the one drawn: it supersedes an older pending change still waiting on its reply.
      renaming.get(id)?.();
      const lift = state.draw(tree => tree.map(node => node.id === id ? { ...node, name } : node));

      renaming.set(id, lift);
      const result = await applying(() => app.rpc("rail.rename", { id, name }));

      // The read holds the Daemon's name before the pending change lifts, so the row never shows the old one between them.
      if (result.kind === "applied") await state.refresh();

      if (result.kind === "pending") state.keepAsked(id, { kind: "rename", asked: name, base });
      lift();

      if (result.kind === "refused") throw result.error;
    },
    keepAsked: (id, change) => {
      setAsked(draft => { draft[id] = change; });

      if (change.kind === "rename") setModel(draft => { for (const node of draft.tree) if (node.id === id) node.name = change.asked; });
      else if (change.kind === "move") setModel(draft => { reconcile(movedTo(snapshot(model.tree), id, change.asked), "id")(draft.tree); });
    },
    failure,
    dismissed: (item) => {
      const key = failureKey(item);

      return key !== null && dismissedKeys().has(key);
    },
    dismiss: (item) => {
      const key = failureKey(item);

      if (key === null) return;
      let next!: ReadonlySet<string>;

      setDismissedKeys(keys => next = new Set(keys).add(key));
      void dismissals?.write([...next]).then(problem => { if (problem !== null) setUnsaved(lines => [...lines.filter(line => line.key !== key), { key, name: isTerminal(item) ? item.program : item.name }]); else setUnsaved([]); });
    },
    unsavedDismissal: () => unsaved()[0]?.name ?? null,
    retryDismissal: () => {
      void dismissals?.write([...dismissedKeys()]).then(problem => { if (problem === null) setUnsaved([]); });
    },
    clearUnsavedDismissal: () => setUnsaved(lines => lines.slice(1)),
    refresh: options => fetching(options?.terminals ? fetchAll : fetchTree),
    selected,
    terminalFocus,
    restored,
    collapsed,
    closedSections,
    setSectionOpen: (section, open) => {
      if (closedSections().has(section) !== open) return;
      saveViewer({ sections: [...closedSections()].filter(each => each !== section).concat(open ? [] : [section]) });
    },
    storageFailure,
    clearStorageFailure: () => setStorageFailure(null),
    toggleCollapsed: (id) => {
      let next!: ReadonlySet<string>;

      setCollapsed((closed) => next = new Set(closed.has(id) ? [...closed].filter((each) => each !== id) : [...closed, id]));
      save({ selected: selected(), collapsed: [...next] });
    },
    select: (id, intent, focus = captureFocus(true)) => select(id, focus, intent),
    shouldAcknowledgeAlerts: () => !restored() && (selectionIntent() === "open" || model.tree.some(node => node.id === selected() && node.kind === "agent")),
    nameOf: (actor) =>
      actor.kind === "user"
        ? "you"
        : actor.kind === "agent"
          ? (model.tree.find((node) => node.id === actor.id)?.name ?? actor.id)
          : actor.id,
    settled: async () => {
      await queue.onIdle();
      await new Promise<void>(resolve => createRoot(done => createEffect(() => fetchingNow() || pending().length > 0, busy => {
        if (busy) return;
        queueMicrotask(done);
        resolve();
      })));
    },
  };

  return state;
};


/** U4523: current ownership is a Rail fact; historical names keep using nameOf. */
export const currentOwner = (rail: Pick<RailState, "nodes" | "exitOf">, actor: Actor | null | undefined) => {
  const node = actor?.kind === "agent" ? rail.nodes.find(node => node.id === actor.id) : undefined;

  return node ? { id: node.id, name: node.name, live: isDoor(node) && node.terminal_id !== null && rail.exitOf(node) === null } : undefined;
};
