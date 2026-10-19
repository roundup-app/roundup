import { createContext, createSignal, useContext } from "solid-js";
import type { Accessor } from "solid-js";
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
import { createTakeover } from "./takeover";
import type { TakeoverState } from "./takeover";
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
      registerRecovery: (surface, resolve) => {
        recovery.set(surface, resolve);
        refresh(undefined);
      },
      availability: (draft, facts) => {
        revision();

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
      edit: (...args) => refresh(storage.edit(...args)),
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
  worktrees: ReturnType<typeof createWorktreeState>;
  drawer: DrawerState;
  decisions: DecisionsState;
  /** U504: the Asks the user sent and where each part went. */
  asks: AsksState;
  /** U187: the Takeover the user holds. */
  takeover: TakeoverState;
  reducedMotion: Accessor<boolean>;
  /** Milliseconds since the epoch, refreshed on a coarse tick; for elapsed times. */
  now: Accessor<number>;
  /** S11: set when the Daemon is not the one the App was built with; read once, at connect. */
  contractNotice: string | null;
  /** How the Daemon ended, once it has; from then on every call fails, so no region sends one. */
  daemonExit: Accessor<DaemonExit | null>;
  /** X17: stops telling the Daemon the window's scheme; called when the Project's connection ends. */
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
): Promise<ConnectedProject> => {
  const contractNotice = await checkContract(app);
  // Issued before the subscription, so a seed that arms a failure after it never meets this call, and awaited beside it, so connecting takes no longer.
  const [stopTerminalScheme, events] = await Promise.all([syncTerminalScheme(app), connectEvents(app)]);
  const rail = createRailState(app, events, storage);

  await rail.settled();

  return { project, drafts, app, events, rail, worktrees: createWorktreeState(app, rail, now, daemonExit), drawer: createDrawer(), decisions: createDecisions(app, events, daemonExit), asks: createAsks(app, events), takeover: createTakeover(app, events, daemonExit), reducedMotion, now, contractNotice, daemonExit, stopTerminalScheme };
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
