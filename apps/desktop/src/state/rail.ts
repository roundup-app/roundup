import type { Size, TerminalPreparation } from "../terminal/emulator";
import { captureFocus } from "../keys/focus";
import { createItemFailure } from "../rail/itemFailure";
import { copy } from "./copy";
import { batch, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Actor } from "@contracts/Actor";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { defaultWorkstreamName } from "../rail/defaultName";
import { ancestorsOf, isWorkstream } from "../rail/layout";
import type { RailSection, RailStorage } from "../rail/persist/storage";
import type { Events } from "../app/events";
import { outcomeOf, type AppSeam } from "../app/seam";

/** How an exited node's program ended: with a code, by a signal, or unknown because the node has no Terminal. */
export type ExitState = { kind: "code"; code: number } | { kind: "signal" } | { kind: "unknown" };

/** U5151c: one failure, bound to its Attempt and Status revision. */
export const failureKey = (node: RailNode): string | null =>
  node.status?.kind === "error" && node.attempt !== null && node.status_revision !== null ? `${node.id}:${node.attempt}:${node.status_revision}` : null;

export type DismissalStorage = {
  read(): string[] | null;
  write(keys: string[]): Promise<string | null>;
};

export type RailState = {
  /** U5151c: whether the owner dismissed this node's current failure. */
  dismissed(node: RailNode): boolean;
  /** U5151c: acknowledge this node's current failure; sends nothing to the Agent. */
  dismiss(node: RailNode): void;
  prepareTerminal?: (() => Promise<TerminalPreparation | undefined>) | undefined;
  commandFailure: ReturnType<typeof createItemFailure>;
  /** Rows in the Daemon's order; only a `rail.tree` call adds or removes one. */
  readonly nodes: readonly RailNode[];
  /** `null` while the node's program runs, and for a Workstream (one with no program). */
  exitOf(node: RailNode): ExitState | null;
  /** X11, X12: every Terminal the Daemon lists, as of the last `terminal.list`. */
  terminals(): readonly TerminalInfo[];
  /** How Terminal `id` ended, or `null` while it runs or when it is unknown. */
  terminalExit(id: string): ExitState | null;
  doorPending(id: string): boolean;
  doorFailure(id: string): string | null;
  startDoor(id: string): Promise<void>;
  /** U9/U62: creates a root Workstream, then selects it and starts its Door once `rail.tree` returns it. */
  createWorkstream(): Promise<void>;
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
  select(id: string | null): void;
  nameOf(actor: Actor): string;
  /** The message of the last failed fetch, until a later fetch succeeds. */
  failure(): string | null;
  /** Fetches the current tree after a write found that its row had already gone; `terminals` also refetches `terminal.list`, so a missed exit shows. */
  refresh(options?: { terminals?: boolean }): Promise<void>;
  /** Resolves when no fetch is in flight and no queued Event is left to apply. */
  settled(): Promise<void>;
};

/** A24: how long the App waits for `rail.startDoor`, the Daemon's own bound of 10 000 ms. */
const DOOR_START_BOUND_MS = 10_000;

export const createRailState = (app: AppSeam, events: Events, storage?: RailStorage, dismissals?: DismissalStorage): RailState => {
  const [model, setModel] = createStore<{ tree: RailNode[]; exited: Record<string, number | null> }>({
    tree: [],
    exited: {},
  });

  const [doors, setDoors] = createStore<Record<string, { pending: boolean; observedLive: boolean; failure: { message: string; attempt: string | null } | null }>>({});
  const [terminals, setTerminals] = createSignal<readonly TerminalInfo[]>([]);
  const commandFailure = createItemFailure(id => model.tree.some(node => node.id === id), terminals);
  const [dismissedKeys, setDismissedKeys] = createSignal<ReadonlySet<string>>(new Set(dismissals?.read() ?? []));
  const [selected, setSelected] = createSignal<string | null>(null);
  const [terminalFocus, setTerminalFocus] = createSignal(captureFocus());
  const [failure, setFailure] = createSignal<string | null>(null);
  const [workstreamCreating, setWorkstreamCreating] = createSignal(false);
  /** The id `rail.createWorkstream` returned, until `rail.tree` shows its row. */
  let wantedWorkstream: string | null = null;
  let workstreamUnknown: string | null = null;
  let workstreamFocus = captureFocus();
  let selectionRevision = 0;
  let workstreamSelection = 0;

  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  const [closedSections, setClosedSections] = createSignal<ReadonlySet<RailSection>>(new Set());
  const [restored, setRestored] = createSignal(false);
  const [storageFailure, setStorageFailure] = createSignal<string | null>(null);
  let firstTree = true;

  const save = async () => {
    const layout: Parameters<RailStorage["write"]>[0] = { selected: selected(), collapsed: [...collapsed()] };

    if (closedSections().size > 0) layout.sections = [...closedSections()];
    setStorageFailure(await storage?.write(layout) ?? null);
  };

  const reveal = (id: string | null) => {
    if (id === null) return;

    const above = new Set(ancestorsOf(model.tree, id));

    setCollapsed((closed) => new Set([...closed].filter((workstream) => !above.has(workstream))));
  };

  let pending = 0;
  let queued: DaemonEvent[] = [];
  let latest: Promise<void> = Promise.resolve();

  const select = (id: string | null, focus = captureFocus(true)): void => {
    selectionRevision++;
    batch(() => {
      setTerminalFocus(() => focus);
      setRestored(false);
      setSelected(id !== null && model.tree.some((node) => node.id === id) ? id : null);
      reveal(selected());
      save();
    });
  };

  const hasLiveTerminal = (node: RailNode) => node.terminal_id !== null && !(node.terminal_id in model.exited);

  const fetchTree = async () => {
    const tree = await app.rpc("rail.tree", null);

    batch(() => {
      setModel("tree", reconcile(tree, { key: "id" }));

      for (const node of tree) {
        if (doors[node.id]?.pending && hasLiveTerminal(node)) setDoors(node.id, "observedLive", true);
        const failed = doors[node.id]?.failure;

        if (failed && (hasLiveTerminal(node) || (node.attempt !== null && BigInt(node.attempt) > BigInt(failed.attempt ?? "0")))) {
          setDoors(node.id, "failure", null);
          commandFailure.acknowledge(node.id);
        }
      }

      if (firstTree) {
        firstTree = false;
        const saved = storage?.read();

        if (saved) {
          setClosedSections(new Set(saved.sections ?? []));
          setSelected(tree.some((node) => node.id === saved.selected) ? saved.selected : null);
          setCollapsed(new Set(saved.collapsed.filter((id) => tree.some((node) => node.id === id && isWorkstream(node)))));
          reveal(selected());
          setRestored(selected() !== null);
          save();
        }
      } else {
        const id = selected();

        if (id !== null && !tree.some((node) => node.id === id)) {
          setSelected(null);
          save();
        }
      }
    });

    const wanted = wantedWorkstream;

    if (wanted !== null && tree.some((node) => node.id === wanted)) {
      wantedWorkstream = null;

      if (selectionRevision === workstreamSelection) select(wanted, workstreamFocus);

      setWorkstreamCreating(false);
      void startDoor(wanted, false);
    }
  };

  const fetchTerminals = async () => {
    const listed = await app.rpc("terminal.list", null);

    setTerminals(listed);

    for (const terminal of listed) {
      if (!terminal.running) setModel("exited", terminal.id, terminal.exit_code);
    }
  };

  /** U3703: select the Agent that owns Terminal `id` (its own, or the Bubble's owner); an unknown id or an owner with no row changes nothing. */
  const showTerminal = (id: string): void => {
    const owner = model.tree.find((node) => node.terminal_id === id)?.id ?? terminals().find((terminal) => terminal.id === id)?.owner;

    if (owner && owner !== selected() && model.tree.some((node) => node.id === owner)) select(owner);
  };

  /** Fetches run one after another, and Events that arrive meanwhile wait: the answer may predate them. */
  const fetching = (work: () => Promise<void>): void => {
    pending += 1;

    latest = latest.then(work).then(
      () => {
        setFailure(null);
      },
      (error) => {
        if (!(error instanceof Error)) throw error;

        setFailure(error.message);
      },
    ).finally(() => {
      pending -= 1;

      if (pending === 0) apply(queued.splice(0));
    });
  };

  const apply = (batch: DaemonEvent[]): void => {
    for (const event of batch) {
      if (pending > 0) {
        queued.push(event);
      } else if (event.name === "rail.changed") {
        fetching(fetchTree);
      } else if (event.name === "agent.status") {
        setModel("tree", (node) => node.id === event.data.id && node.attempt === event.data.attempt && node.status_revision !== null && BigInt(event.data.status_revision) > BigInt(node.status_revision), { status: event.data.status, status_revision: event.data.status_revision });
      } else if (event.name === "agent.toolCall") {
        setModel("tree", (node) => node.id === event.data.id, "tool_call", reconcile(event.data.call));
      } else if (event.name === "terminal.changed") {
        fetching(fetchTerminals);
      } else if (event.name === "terminal.shown") {
        showTerminal(event.data.id);
      } else if (event.name === "terminal.exited") {
        setModel("exited", event.data.id, event.data.code);
      }
    }
  };

  /** A24: the call's answer, or a rejection once `DOOR_START_BOUND_MS` passes without one. */
  const boundedStart = (id: string, size?: Size): Promise<RailNode> => {
    const { promise: expiry, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(() => reject(new Error(copy.theDoorDidNotStartInTimeRetry)), DOOR_START_BOUND_MS);

    return Promise.race([app.rpc("rail.startDoor", { id, ...size }), expiry]).finally(() => clearTimeout(timer));
  };

  const startDoor = async (id: string, focus = true): Promise<void> => {
    if (doors[id]?.pending) return;

    if (focus && selected() === id) batch(() => {
      setTerminalFocus(() => captureFocus(true));
      setRestored(false);
    });
    setDoors(id, { pending: true, observedLive: false, failure: null });

    let prepared: TerminalPreparation | undefined;

    try {
      if (selected() === id) prepared = await state.prepareTerminal?.();
      const node = await boundedStart(id, prepared?.size);

      if (node.terminal_id) prepared?.bind(node.terminal_id);
      commandFailure.acknowledge(id);
      fetching(fetchTree);
      await latest;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      fetching(fetchTree);
      await latest;
      const node = model.tree.find((each) => each.id === id);

      if (node && !hasLiveTerminal(node) && !doors[id]?.observedLive) {
        setDoors(id, "failure", { message: error.message, attempt: node.attempt });
        commandFailure.show(error.message, id, "pane");
      }
    } finally {
      prepared?.dispose();
      setDoors(id, "pending", false);
    }
  };

  const createWorkstream = (): Promise<void> => {
    const params = { name: defaultWorkstreamName(model.tree), parent: null };

    // The connection and these arguments outlive the Rail that offered the action.
    const create = async (): Promise<void> => {
      if (workstreamCreating()) return;
      setWorkstreamCreating(true);

      try {
        if (workstreamUnknown !== null && !await app.ask({ title: copy.newWorkstreamTitle, message: `${copy.terminalOutcomeUnknown}${workstreamUnknown}`, okLabel: copy.newWorkstreamTitle, cancelLabel: copy.keep })) return;

        workstreamFocus = captureFocus(true);
        workstreamSelection = selectionRevision;
        wantedWorkstream = (await app.rpc("rail.createWorkstream", params)).id;
        workstreamUnknown = null;
        commandFailure.acknowledge(null);
        fetching(fetchTree);
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        workstreamUnknown = outcomeOf(error) === "unknown" ? error.message : null;
        commandFailure.show(`${copy.newWorkstreamTitle}: ${workstreamUnknown !== null ? copy.terminalOutcomeUnknown : ""}${error.message}`, null, "rail", () => { void create(); });
      } finally {
        if (wantedWorkstream === null) setWorkstreamCreating(false);
      }
    };

    return create();
  };

  events.subscribe((event) => apply([event]));
  fetching(async () => {
    await Promise.all([fetchTree(), fetchTerminals()]);
  });

  const state: RailState = {
    commandFailure,
    terminals,
    terminalExit: (id) => {
      if (!(id in model.exited)) return null;

      const code = model.exited[id] ?? null;

      return code === null ? { kind: "signal" } : { kind: "code", code };
    },
    doorPending: (id) => doors[id]?.pending ?? false,
    doorFailure: (id) => doors[id]?.failure?.message ?? null,
    startDoor,
    createWorkstream,
    workstreamCreating,
    clearWorkstreamFailure: () => commandFailure.acknowledge(null),
    get nodes() {
      return model.tree;
    },
    exitOf: (node) => {
      if (node.terminal_id === null) return { kind: "unknown" };

      if (!(node.terminal_id in model.exited)) return null;

      const code = model.exited[node.terminal_id] ?? null;

      return code === null ? { kind: "signal" } : { kind: "code", code };
    },
    failure,
    dismissed: (node) => {
      const key = failureKey(node);

      return key !== null && dismissedKeys().has(key);
    },
    dismiss: (node) => {
      const key = failureKey(node);

      if (key === null) return;
      const next = new Set(dismissedKeys()).add(key);

      setDismissedKeys(next);
      void dismissals?.write([...next]);
    },
    refresh: async (options) => {
      if (options?.terminals) fetching(async () => { await Promise.all([fetchTree(), fetchTerminals()]); });
      else fetching(fetchTree);
      await latest;
    },
    selected,
    terminalFocus,
    restored,
    collapsed,
    closedSections,
    setSectionOpen: (section, open) => {
      if (closedSections().has(section) !== open) return;
      setClosedSections(closed => new Set(open ? [...closed].filter(each => each !== section) : [...closed, section]));
      void save();
    },
    storageFailure,
    clearStorageFailure: () => setStorageFailure(null),
    toggleCollapsed: (id) => {
      setCollapsed((closed) => new Set(closed.has(id) ? [...closed].filter((each) => each !== id) : [...closed, id]));
      save();
    },
    select,
    nameOf: (actor) =>
      actor.kind === "user"
        ? "you"
        : actor.kind === "agent"
          ? (model.tree.find((node) => node.id === actor.id)?.name ?? actor.id)
          : actor.id,
    settled: async () => {
      let seen: Promise<void>;

      do {
        seen = latest;
        await seen;
      } while (latest !== seen);
    },
  };

  return state;
};


/** U4523: current ownership is a Rail fact; historical names keep using nameOf. */
export const currentOwner = (rail: Pick<RailState, "nodes" | "exitOf">, actor: Actor | null | undefined) => {
  const node = actor?.kind === "agent" ? rail.nodes.find(node => node.id === actor.id) : undefined;

  return node ? { id: node.id, name: node.name, live: node.terminal_id !== null && rail.exitOf(node) === null } : undefined;
};
