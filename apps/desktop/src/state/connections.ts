import { createEffect, createMemo, createResource, mapArray, on, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { ShelfRequest } from "./projectView";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Requested } from "@contracts/project/Requested";
import type { App as AppCalls, ActionReply, ActionRequest, Project } from "../app/seam";
import { applyConfig } from "../settings/configApply";
import { connectProject } from "./connectedProject";
import type { ConnectedProject, createProjectDrafts } from "./connectedProject";
import type { Clock } from "./clock";
import type { OpenTab } from "./projects";
import { railStorage } from "./railStorage";

/** One open tab's connection to its Daemon (U6920a). A failed one keeps `last`, the last connected value or none. */
export type Connection =
  | { kind: "connecting" }
  | { kind: "connected"; open: ConnectedProject }
  | { kind: "failed"; error: Error; last: ConnectedProject | null };

/** What the tab's regions read: the live connection, or the last one while a reconnect fails. */
export const connectedOf = (connection: Connection | undefined): ConnectedProject | undefined => {
  if (connection?.kind === "connected") return connection.open;

  return connection?.kind === "failed" ? connection.last ?? undefined : undefined;
};

/** Every open tab that has a connection to read, by Project path. */
export const connectedEntries = (connections: ReadonlyMap<string, Connection>): [string, ConnectedProject][] =>
  [...connections].flatMap(([path, each]) => {
    const open = connectedOf(each);

    return open ? [[path, open]] : [];
  });

type Attempt = { kind: "connected"; open: ConnectedProject } | { kind: "failed"; error: Error } | null;

export type ConnectionDeps = {
  app: AppCalls;
  tabOf: (path: string) => OpenTab | undefined;
  reducedMotion: Accessor<boolean>;
  now: Accessor<number>;
  clock: Clock;
  drafts: ReturnType<typeof createProjectDrafts>;
  onRecovered: (path: string, generation: number) => void;
  onRequested: (request: Requested) => void;
  onOpen: (request: Extract<ActionRequest, { method: "project.open" | "project.start" }>, signal: AbortSignal) => Promise<ActionReply>;
  /** MC40, MC41: a look or keys file the App refused, as a Toast. */
  configFailure: (path: string, file: string, cause: string) => void;
  /** U410: the Events of this Project that make a Toast; it returns what stops them. */
  watch: (open: ConnectedProject) => () => void;
  active: (path: string) => boolean;
  /** U3566: this Project is on screen in a visible, focused window. */
  viewing: (path: string) => boolean;
  /** U6271a: every open Project, so a placed part reaches its own Daemon. */
  open: () => readonly Project[];
  /** U6271c: another Project's Rail nodes, and showing it with one of its Workstreams selected. */
  nodes: (path: string) => readonly RailNode[];
  openIn: (path: string, workstream: string) => void;
  openShelf: ShelfRequest;
};

/** One Project's live connection, kept while its tab is open and its regions are not on screen, so its Tab mark stays current (U181). */
const createConnection = (path: string, deps: ConnectionDeps): Accessor<Connection> => {
  const tab = () => deps.tabOf(path);
  const project = untrack(tab)?.project;

  if (!project) return () => ({ kind: "connecting" });

  let registration = new AbortController();
  onCleanup(() => registration.abort());
  createEffect(() => { if (tab()?.exit) registration.abort(); });

  const [attempt] = createResource(() => tab()?.generation, async (generation): Promise<Attempt> => {
    const exit = tab()?.exit;

    try {
      registration.abort();
      registration = new AbortController();
      const captured = registration;
      const calls = deps.app.forProject(path);

      const open = await connectProject({ ...calls, serveActions: async (answer, invalidated) => {
        await calls.serveActions?.(request => (request.method === "project.open" || request.method === "project.start")
          ? deps.onOpen(request, captured.signal) : answer(request), () => { captured.abort(); invalidated?.(); });
      } }, project, deps.reducedMotion, deps.now, () => tab()?.generation === generation ? tab()?.exit ?? null : { code: null, recovery: "connecting" }, railStorage(path), deps.drafts(path), () => deps.viewing(path), deps.clock, { app: deps.app, open: deps.open, nodes: deps.nodes, show: deps.openIn }, deps.openShelf);

      if (tab()?.generation !== generation) {
        open.stopTerminalScheme();

        return null;
      }

      // Clearing a newer exit would hide its Reopen action.
      if (tab()?.exit === exit) deps.onRecovered(path, generation);

      return { kind: "connected", open };
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;

      return { kind: "failed", error: failure };
    }
  });

  // A failed replacement keeps the last valid connection while the native owner retries.
  const connection = createMemo<Connection>(previous => {
    const latest = attempt.latest;

    if (!latest) return previous;

    return latest.kind === "connected" ? latest : { kind: "failed", error: latest.error, last: connectedOf(previous) ?? null };
  }, { kind: "connecting" });

  const open = createMemo(() => connectedOf(connection()));

  createEffect(() => open()?.worktrees.watch(() => deps.active(path)));

  // M8: rename keeps its request Event; open completes through the registered App relay.
  createEffect(on(open, (current) => {
    if (!current) return;

    const config = () => void applyConfig(current.app, (file, cause) => deps.configFailure(path, file, cause));

    config();

    const stop = current.events.subscribe((event) => {
      if (event.name === "project.requested") deps.onRequested(event.data);
      else if (event.name === "config.changed") config();
    });

    onCleanup(stop);
  }));

  // U410: the Events of this Project that make a Toast.
  createEffect(() => {
    const current = open();

    if (!current) return;

    // Untracked: watchProject reads the Rail's nodes, and each Status change would else rebuild the watch with that change already seen.
    onCleanup(untrack(() => deps.watch(current)));
  });

  createEffect(() => {
    const current = open();

    if (current) onCleanup(current.stopTerminalScheme);
  });

  return connection;
};

/** One `Connection` per open tab, keyed by Project path; a closed tab ends its connection with its root. */
export const createConnections = (paths: Accessor<readonly string[]>, deps: ConnectionDeps): Accessor<ReadonlyMap<string, Connection>> => {
  const mapped = mapArray(paths, path => ({ path, connection: createConnection(path, deps) }));

  return createMemo(() => new Map(mapped().map(({ path, connection }) => [path, connection()])));
};
