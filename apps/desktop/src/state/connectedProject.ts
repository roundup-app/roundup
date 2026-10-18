import { createContext, useContext } from "solid-js";
import type { Accessor } from "solid-js";
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

/** Everything a region of an open Project reads: the Project and its live connection to the Daemon. */
export type ConnectedProject = {
  project: Project;
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
): Promise<ConnectedProject> => {
  const contractNotice = await checkContract(app);
  // Issued before the subscription, so a seed that arms a failure after it never meets this call, and awaited beside it, so connecting takes no longer.
  const [stopTerminalScheme, events] = await Promise.all([syncTerminalScheme(app), connectEvents(app)]);
  const rail = createRailState(app, events, storage);

  await rail.settled();

  return { project, app, events, rail, worktrees: createWorktreeState(app, rail, now, daemonExit), drawer: createDrawer(), decisions: createDecisions(app, events, daemonExit), asks: createAsks(app, events), takeover: createTakeover(app, events, daemonExit), reducedMotion, now, contractNotice, daemonExit, stopTerminalScheme };
};

export const ConnectedProjectContext = createContext<ConnectedProject>();

export const useConnectedProject = (): ConnectedProject => {
  const connected = useContext(ConnectedProjectContext);

  if (!connected) throw new Error("no open Project: a region read the ConnectedProject outside one");

  return connected;
};
