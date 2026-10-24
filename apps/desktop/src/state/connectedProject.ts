import { notesFor } from "../changes/notes";
import { withAppSettings } from "../settings/preferences";
import { createContext, createRoot, createSignal, getOwner, onCleanup, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import { createImport } from "../rail/importState";
import { draftStorage } from "./storage";
import { checkContract } from "../app/contractMatch";
import { connectEvents } from "../app/events";
import type { Events } from "../app/events";
import type { AppSeam, DaemonExit, Project } from "../app/seam";
import { createDecisions } from "../decisions/decisions";
import type { DecisionsState } from "../decisions/decisions";
import { createDrawer } from "../drawer/drawer";
import type { DrawerState } from "../drawer/drawer";
import { createWorktreeState } from "./worktrees";
import { createAsks } from "./asks";
import type { AsksState } from "./asks";
import { syncTerminalScheme } from "../terminal/scheme";
import { createRailState } from "./rail";
import { createUnseen, unseenStorage } from "./unseen";
import type { UnseenState } from "./unseen";
import { createQueue } from "./queue";
import { createTimelineLog } from "../timeline/log";
import type { TimelineLog } from "../timeline/log";
import type { QueueView } from "./queue";
import { createSettingsView } from "./settingsView";
import type { SettingsViewState } from "./settingsView";
import { createTakeover } from "./takeover";
import { createNoteQueue } from "./noteQueue";
import type { NoteQueue } from "./noteQueue";
import type { TakeoverState } from "./takeover";
import type { RailStorage } from "../rail/persist/storage";
import type { RailState } from "./rail";

type Drafts = ReturnType<typeof draftStorage>;

type Draft = ReturnType<Drafts["list"]>[number];

type Availability = "available" | "unavailable" | "unverified";

type Recovery = (draft: Draft, facts: {
  rail: Pick<RailState, "nodes" | "terminals" | "terminalExit" | "failure">;
  daemonExit: Accessor<DaemonExit | null>;
  decisions: Pick<DecisionsState, "availability">;
}) => Availability;

type ProjectDrafts = Drafts & {
  importing: ReturnType<typeof createImport> | null;
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
export const createProjectDrafts = () => {
  const projects = new Map<string, ProjectDrafts>();

  return (path: string): ProjectDrafts => {
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
      importing: null,
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

    return holder;
  };
};

/** Everything a region of an open Project reads: the Project and its live connection to the Daemon. */
export type ConnectedProject = {
  project: Project;
  /** App-owned across surface disposal and connection replacement; keyed by original path. */
  drafts: ProjectDrafts;
  app: AppSeam;
  events: Events;
  rail: RailState;
  /** U3566: the Agents whose latest finish the user has not viewed. */
  unseen: UnseenState;
  /** U3744: the Workstreams waiting to start. */
  queue: QueueView;
  /** U3768: the Agents' Statuses heard since the Project connected, read by the timeline. */
  timeline: TimelineLog;
  importing: ReturnType<typeof createImport>;
  worktrees: ReturnType<typeof createWorktreeState>;
  drawer: DrawerState;
  decisions: DecisionsState;
  /** U504: the Asks the user sent and where each part went. */
  asks: AsksState;
  /** U187: the Takeover the user holds. */
  takeover: TakeoverState;
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
};

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
  // Preserve the Project-owned Notes lookup for observers using the original connection.
  notesFor(app, project.path, drafts);
  app = withAppSettings(app, id => rail.nodes.find(node => node.id === id)?.can_resume ?? false);
  let ended = false;
  let stopDecisions = () => {};

  // Connection setup crosses awaits. Register teardown while its owner is still current,
  // including a tab closed before setup finishes, or its recovery resource would retain it.
  if (getOwner()) onCleanup(() => { ended = true; stopDecisions(); });

  const contractNotice = await checkContract(app);
  // Issued before the subscription, so a seed that arms a failure after it never meets this call, and awaited beside it, so connecting takes no longer.
  const [stopTerminalScheme, events] = await Promise.all([syncTerminalScheme(app), connectEvents(app)]);
  const rail = createRailState(app, events, storage);

  await rail.settled();

  const decisions = createRoot((dispose) => {
    stopDecisions = dispose;

    return createDecisions(app, events, daemonExit, drafts, () => new Set(rail.nodes.map((node) => node.id)));
  });

  if (ended) stopDecisions();

  const settingsView = createSettingsView();
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

  const timeline = createTimelineLog(events, rail);

  const onImported = (id: string, agent: string | null) => {
    void rail.refresh().then(() => rail.select(agent ?? id));
  };

  // Import selections and pending acknowledgements share the App-owned Project lifetime.
  const importing = drafts.importing ?? createImport(app, project.path, onImported, drafts);

  importing.reconnect(app, onImported);
  drafts.importing = importing;

  const takeover = createTakeover(app, events, daemonExit);

  return { project, drafts, app, events, rail, unseen, queue, timeline, importing, worktrees: createWorktreeState(app, rail, now, daemonExit), drawer: createDrawer(), decisions, asks: createAsks(app, events), takeover, settingsView, notes: createNoteQueue(app, events, reducedMotion, daemonExit), reducedMotion, now, contractNotice, daemonExit, stopTerminalScheme: () => { timeline.stop(); stopDecisions(); stopQueue(); stopUnseen(); stopTerminalScheme(); } };
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
