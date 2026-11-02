import { createHeld } from "./held";
import { createTodoUndo } from "../todos/deleteTodos";
import type { RpcMethodName } from "@contracts/methods";
import { retryRead } from "../app/seam";
import { notesFor } from "../changes/notes";
import { withAppSettings } from "../settings/preferences";
import { createContext, createEffect, createRoot, createSignal, getOwner, onCleanup, untrack, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import { createImport } from "../rail/importState";
import { draftStorage } from "./storage";
import { copy } from "./copy";
import { checkContract } from "../app/contractMatch";
import { serveActions } from "../keys/actions";
import { connectEvents } from "../app/events";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit, Project } from "../app/seam";
import { createDrawer } from "../drawer/drawer";
import type { DrawerState } from "../drawer/drawer";
import { createWorktreeState } from "./worktrees";
import { createAsks } from "./asks";
import type { AsksState } from "./asks";
import { syncTerminalScheme } from "../terminal/scheme";
import { createRailState } from "./rail";
import { dismissalStorage } from "../rail/persist/storage";
import { createUnseen, unseenStorage } from "./unseen";
import type { UnseenState } from "./unseen";
import { createQueue } from "./queue";
import type { QueueView } from "./queue";
import { createSettingsView } from "./settingsView";
import type { SettingsViewState } from "./settingsView";
import { createNoteQueue } from "./noteQueue";
import type { NoteQueue } from "./noteQueue";
import type { RailStorage } from "../rail/persist/storage";
import type { RailState } from "./rail";

type Drafts = ReturnType<typeof draftStorage>;

type Draft = ReturnType<Drafts["list"]>[number];

type Availability = "available" | "unavailable" | "unverified";

type Recovery = (draft: Draft, facts: {
  rail: Pick<RailState, "nodes" | "terminals" | "terminalExit" | "failure">;
  daemonExit: Accessor<DaemonExit | null>;
}) => Availability;

type ProjectDrafts = Drafts & {
  todoUndo: ReturnType<typeof createTodoUndo>;
  importing: ReturnType<typeof createImport> | null;
  settingsView: SettingsViewState;
  /** Surface-owned identity extraction, installed independently of the original editor.
   * App-run lifetime; facts come from the inspected connection, never a captured old one.
   */
  registerRecovery(surface: string, resolve: Recovery): void;
  availability(draft: Draft, facts: Parameters<Recovery>[1]): Availability;
};

/** App-run ownership, keyed by the original path, survives connection/editor teardown.
 * Surface owners use connected.drafts for complete forms and captured submission revisions;
 * never construct another draftStorage for a connected Project. No operation delivers work.
 */
export const createProjectDrafts = (): ((path: string) => ProjectDrafts) & { paths?: Accessor<string[]> } => {
  const projects = new Map<string, ProjectDrafts>();

  const [paths, setPaths] = createSignal<string[]>([]);

  const forProject = (path: string): ProjectDrafts => {
    const existing = projects.get(path);

    if (existing) return existing;

    const storage = draftStorage(path);
    const [revision, changed] = createSignal(0);

    const refresh = <T,>(result: T): T => {
      changed((value) => value + 1);

      return result;
    };

    const recovery = new Map<string, Recovery>();

    const holder: ProjectDrafts = {
      todoUndo: createTodoUndo(),
      importing: null,
      settingsView: createSettingsView(),
      editor: storage.editor,
      recoverable: () => {
        revision();

        return storage.recoverable();
      },
      registerRecovery: (surface, resolve) => {
        recovery.set(surface, resolve);
        refresh(undefined);
      },
      availability: (draft, facts) => {
        revision();

        if (draft.destination.surface === "terminal_selection") return "unavailable";

        return recovery.get(draft.destination.surface)?.(draft, facts) ?? "unverified";
      },
      list: () => {
        revision();

        return storage.list();
      },
      problem: () => {
        revision();

        return storage.problem();
      },
      validate: (...args) => refresh(storage.validate(...args)),
      edit: (...args) => refresh(storage.edit(...args)),
      setSelection: (...args) => refresh(storage.setSelection(...args)),
      submit: (...args) => refresh(storage.submit(...args)),
      settle: (...args) => refresh(storage.settle(...args)),
      discard: (...args) => refresh(storage.discard(...args)),
      retry: () => refresh(storage.retry()),
    };

    projects.set(path, holder);
    setPaths(all => [...all, path]);

    return holder;
  };

  return Object.assign(forProject, { paths });
};

/** Everything a region of an open Project reads: the Project and its live connection to the Daemon. */
export type ConnectedProject = {
  project: Project;
  /** App-owned across surface disposal and connection replacement; keyed by original path. */
  drafts: ProjectDrafts;
  app: AppSeam;
  events: Events;
  rail: RailState;
  held: ReturnType<typeof createHeld>;
  /** U3566: the Agents whose latest finish the user has not viewed. */
  unseen: UnseenState;
  /** U3744: the Workstreams waiting to start. */
  queue: QueueView;
  importing: ReturnType<typeof createImport>;
  creation: Accessor<{ kind: "todo" | "pad" | "terminal"; home: string } | null>;
  createIn: (kind: "todo" | "pad" | "terminal", home: string) => void;
  finishCreation: () => void;
  /** U4457: the Agent whose Pads group the Shelf is asked to show, until the Pads tab has taken it. */
  padsRequest: Accessor<string | null>;
  padsOwner: Accessor<string | null>;
  showPadsOf: (agent: string, tab?: "todos") => void;
  padsTab: Accessor<"pads" | "todos">;
  finishPadsRequest: () => void;
  view: Accessor<string | null>;
  hasView: (view: string) => boolean;
  hideView: (view: string) => void;
  showView: (view: string | null) => void;
  worktrees: ReturnType<typeof createWorktreeState>;
  drawer: DrawerState;
  /** U504: the Asks the user sent and where each part went. */
  asks: AsksState;
  /** U3780: the notes waiting for each Agent. */
  notes: NoteQueue;
  /** U3764: the Project settings view in the centre. */
  settingsView: SettingsViewState;
  reducedMotion: Accessor<boolean>;
  /** Milliseconds since the epoch, refreshed on a coarse tick; for elapsed times. */
  now: Accessor<number>;
  /** S11: set when the Daemon is not the one the App was built with; read once, at connect. */
  contractNotice: string | null;
  /** How the Daemon ended, once it has; from then on every call fails, so no region sends one. */
  daemonExit: Accessor<DaemonExit | null>;
  /** Disposes connection-owned reads and X17 scheme updates when the connection ends. */
  stopTerminalScheme: () => void;
  terminalScheme: Awaited<ReturnType<typeof syncTerminalScheme>>;
};

// Explicit read allowlist: subscriptions, cursor acknowledgments and commands never replay.
const reads = new Set<RpcMethodName>([
  "daemon.ping", "daemon.methods", "rail.tree", "terminal.list",
  "terminal.snapshot", "terminal.screen", "terminal.read", "terminal.search",
  "todo.list", "todo.get", "todo.listHanded", "todo.getHistory", "todo.comments",
  "todo.unread", "todo.refs", "todo.deletion", "pad.list", "pad.read", "pad.getDeletion",
  "agent.worktreeState", "agent.changedFiles", "agent.compareFile", "agent.spawnPrompt",
  "agent.instructions", "agent.context", "agent.brief", "agent.skills", "agent.digest", "agent.extras",
  "project.get", "project.getPrepared", "project.resources", "models.list", "import.list", "project.importDiscover",
  "message.get", "message.list",
  "message.progress", "message.reconcileWork", "route.list", "ask.list",
  "deliverable.list", "deliverable.get", "deliverable.resolve", "link.read",
  "provenance.history", "provenance.touched", "reaction.list", "reaction.get", "reaction.preview",
  "workstream.queue",
]);

export const connectProject = async (
  app: AppSeam,
  project: Project,
  reducedMotion: Accessor<boolean>,
  now: Accessor<number>,
  daemonExit: Accessor<DaemonExit | null> = () => null,
  storage?: RailStorage,
  drafts = createProjectDrafts()(project.path),
  /** U3566: whether the selected Agent's pane is displayed in a visible, focused, active window. */
  viewing: Accessor<boolean> = () => true,
): Promise<ConnectedProject> => {
  drafts.todoUndo.reconnect(app);
  const original = app;

  notesFor(original, project.path, drafts);

  const rpc: AppSeam["rpc"] = (method, params) => {
    if (!reads.has(method)) return original.rpc(method, params);

    const captured = structuredClone(params);

    return retryRead(() => original.rpc(method, captured));
  };

  app = { ...app, rpc, get showContextMenu() { return original.showContextMenu; } };
  // Preserve the Project-owned Notes lookup for observers using the original connection.
  notesFor(app, project.path, drafts);
  app = withAppSettings(app, id => rail.nodes.find(node => node.id === id)?.can_resume ?? false);
  let ended = false;

  // Connection setup crosses awaits. Register teardown while its owner is still current,
  // including a tab closed before setup finishes, or its recovery resource would retain it.
  if (getOwner()) onCleanup(() => { ended = true; });

  const contractNotice = await checkContract(app);
  // Issued before the subscription, so a seed that arms a failure after it never meets this call, and awaited beside it, so connecting takes no longer.
  const [terminalScheme, events] = await Promise.all([syncTerminalScheme(app), connectEvents(app)]);
  let stopRail = () => {};

  // NA6: from here the Daemon can relay `action.list` and `action.run` to this window.
  serveActions(app).catch(error => console.error(copy.actionsUnregistered, error));

  const rail = createRoot(dispose => {
    stopRail = dispose;

    return createRailState(app, events, storage, dismissalStorage(project.path));
  });

  if (ended) stopRail();

  await rail.settled();

  const held = createHeld(project.path, cause => rail.commandFailure.show(cause, null, "rail"));
  const settingsView = drafts.settingsView;
  let stopUnseen = () => {};

  const unseen = createRoot((dispose) => {
    stopUnseen = dispose;

    return createUnseen(() => rail.nodes, rail.selected, () => viewing() && !settingsView.open(), unseenStorage(project.path));
  });

  if (ended) stopUnseen();

  let stopQueue = () => {};

  const queue = createRoot((dispose) => {
    stopQueue = dispose;

    return createQueue(app, events, rail);
  });

  if (ended) stopQueue();


  let stopAsks = () => {};

  const asks = createRoot(dispose => {
    stopAsks = dispose;

    return createAsks(app, events, { path: project.path, target: () => {
      if (!viewing() || settingsView.open() || daemonExit() !== null) return null;

      const node = rail.nodes.find(node => node.id === rail.selected());

      return node?.kind === "workstream" && node.terminal_id !== null ? node.id : null;
    } });
  });

  if (ended) stopAsks();

  const onImported = (id: string, agent: string | null) => {
    void rail.refresh().then(() => rail.select(agent ?? id));
  };

  // Import selections and pending acknowledgements share the App-owned Project lifetime.
  const importing = drafts.importing ?? createImport(app, project.path, onImported, drafts);

  importing.reconnect(app, onImported);
  drafts.importing = importing;


  const [creation, setCreation] = createSignal<{ kind: "todo" | "pad" | "terminal"; home: string } | null>(null);
  const createIn = (kind: "todo" | "pad" | "terminal", home: string) => setCreation({ kind, home });
  const finishCreation = () => setCreation(null);
  const [padsRequest, setPadsRequest] = createSignal<string | null>(null);
  const [padsDestination, setPadsDestination] = createSignal<{ agent: string; selection: string | null; tab: "todos" } | null>(null);

  const padsOwner = () => {
    const destination = padsDestination();

    return destination?.selection === rail.selected() ? destination.agent : null;
  };

  const padsTab = () => padsDestination()?.tab ?? "todos";

  const showPadsOf = (agent: string, tab: "todos" = "todos") => {
    setPadsDestination({ agent, selection: rail.selected(), tab });
    setPadsRequest(agent);
  };

  const finishPadsRequest = () => setPadsRequest(null);

  const [views, setViews] = createSignal<readonly string[]>([]);
  const view = () => views().at(-1) ?? null;
  const hasView = (name: string) => views().includes(name);
  const showView = (name: string | null) => { setViews(previous => name === null ? [] : previous.includes(name) ? previous : [...previous, name]); };

  const hideView = (name: string) => { setViews(previous => previous.includes(name) ? previous.filter(value => value !== name) : previous); };

  return { creation, createIn, finishCreation, padsTab, padsRequest, padsOwner, showPadsOf, finishPadsRequest, view, hasView, showView, hideView, project, drafts, app, events, rail, held, terminalScheme, unseen, queue, importing, worktrees: createWorktreeState(app, rail, now, daemonExit), drawer: createDrawer(), asks, settingsView: drafts.settingsView, notes: createNoteQueue(app, events, daemonExit), reducedMotion, now, contractNotice, daemonExit, stopTerminalScheme: () => { stopRail(); stopQueue(); stopUnseen(); stopAsks(); terminalScheme.stop(); } };
};

/** App-run authority for owners outside a connection, including Project tabs.
 * Resolve by the original Project path, even after its connection or tab closes.
 */
export const ProjectDraftsContext = createContext<ReturnType<typeof createProjectDrafts>>();

export const ConnectedProjectContext = createContext<ConnectedProject>();

export const useConnectedProject = (): ConnectedProject => {
  const connected = useContext(ConnectedProjectContext);

  if (!connected) throw new Error("no open Project: a region read the ConnectedProject outside one");

  return connected;
};

/** Consume only the creation requested for this surface, retaining its captured Home. */
export const useCreation = (kind: "todo" | "pad" | "terminal", consume: (home: string) => void) => {
  const connected = useConnectedProject();

  createEffect(() => {
    const request = connected.creation();

    if (request?.kind !== kind) return;

    connected.finishCreation();
    untrack(() => consume(request.home));
  });
};
