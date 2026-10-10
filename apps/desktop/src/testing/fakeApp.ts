import type { Event as DaemonEvent } from "@contracts/Event";
import type { RpcMethodName, RpcMethods } from "@contracts/methods";
import { RpcError } from "../app/seam";
import type { AppSeam, DaemonExit, DaemonExited, FileDrop, Project } from "../app/seam";

const CONFLICT = -32003;

const METHOD_NOT_FOUND = -32601;

export type Handlers = {
  [M in RpcMethodName]?: (
    params: RpcMethods[M]["params"],
  ) => RpcMethods[M]["result"] | Promise<RpcMethods[M]["result"]>;
};

/** Reads the regions make once a Project is open answer empty; any other method fails with METHOD_NOT_FOUND until a test installs a handler. */
const emptyReads: Handlers = {
  "rail.tree": () => [],
  "terminal.list": () => [],
  "todo.list": () => [],
  "message.list": () => [],
  "pad.list": () => [],
  "decision.list": () => [],
  "provenance.history": () => [],
};

export type FakeApp = AppSeam & {
  /** Every `rpc` call so far, in call order. */
  calls: { method: RpcMethodName; params: unknown }[];
  handlers: Handlers;
  emit(event: DaemonEvent): void;
  /** Ends the Daemon of `path`, the open Project's by default; the webview hears `daemon-exited` with its path. */
  exitDaemon(exit: DaemonExit, path?: string): void;
  /** Every path `close_project` was called for, in order. */
  closed: string[];
  /** Delivers one File drop step to every listener, as the native window would. */
  dropFiles(drop: FileDrop): void;
  /** What the macOS chooser answers; `null` is a cancel. */
  chooser: { path: string | null; savePath: string | null; suggestedNames: string[] };
  /** Every Dock badge count set so far, in order. */
  badges: number[];
  /** The first open Project (setting it makes it the only one open), or the error `open_project` fails with. */
  opened: { project: Project | null; failure: RpcError | null };
  /** Opens another Project beside those open, as `open_project` does, and returns its name and path. */
  add(path: string, name?: string): Project;
  /** The fake Daemon of one open Project: `app` itself for the first, and one with its own calls, handlers, events and proof for any other (S8). */
  of(path: string): FakeApp;
  /** What `daemon_proof` answers, or the error it fails with (H18). */
  proof: { value: string; failure: RpcError | null };
};

const folderOf = (path: string): string => path.split("/").pop() ?? path;

export const createFakeApp = (): FakeApp => {
  let onEvent: ((event: DaemonEvent) => void) | null = null;
  const exitListeners = new Set<(exit: DaemonExited) => void>();
  const exited = new Set<string>();
  const dropListeners = new Set<(drop: FileDrop) => void>();
  let open: Project[] = [];
  let primary: string | null = null;
  const others = new Map<string, FakeApp>();

  const nameAt = (path: string): string => open.find((project) => project.path === path)?.name ?? folderOf(path);

  const app: FakeApp = {
    calls: [],
    handlers: { ...emptyReads },
    chooser: { path: null, savePath: null, suggestedNames: [] },
    badges: [],
    opened: {
      get project() {
        return open[0] ?? null;
      },
      set project(project) {
        open = project ? [project] : [];
        primary = null;
        exited.clear();
        others.clear();
      },
      failure: null,
    },
    proof: { value: "fake-proof", failure: null },
    emit: (event) => {
      if (!onEvent) throw new Error("the webview has not subscribed yet");

      onEvent(event);
    },
    closed: [],
    exitDaemon: (exit, path) => {
      const named = path ?? open[0]?.path ?? "";

      exited.add(named);

      for (const listener of exitListeners) listener({ path: named, ...exit });
    },
    dropFiles: (drop) => {
      for (const listener of dropListeners) listener(drop);
    },
    projects: async () => open.map((project) => ({ ...project, running: !exited.has(project.path) })),
    add: (path, name) => {
      exited.delete(path);

      if (!open.some((project) => project.path === path)) open = [...open, { name: name ?? folderOf(path), path }];

      return { name: nameAt(path), path };
    },
    openProject: async (path) => {
      if (app.opened.failure) throw app.opened.failure;

      return app.add(path);
    },
    closeProject: async (path) => {
      app.closed.push(path);
      open = open.filter((project) => project.path !== path);
      exited.delete(path);
    },
    renameProject: async (path, name) => {
      if (!open.some((project) => project.path === path)) throw new RpcError(CONFLICT, `${path} is not open`);

      const renamed = { name: name.trim() || folderOf(path), path };

      open = open.map((project) => (project.path === path ? renamed : project));

      return renamed;
    },
    of: (path) => {
      primary ??= path;

      if (path === primary) return app;

      const existing = others.get(path);

      if (existing) return existing;

      const other = createFakeApp();

      // The Project-wide calls are the one App's; only the Daemon's own calls, events and proof are this Project's.
      Object.assign(other, {
        projects: app.projects,
        add: app.add,
        openProject: app.openProject,
        closeProject: app.closeProject,
        renameProject: app.renameProject,
        of: app.of,
        forProject: app.forProject,
        exitDaemon: app.exitDaemon,
        onDaemonExited: app.onDaemonExited,
        onFileDrop: app.onFileDrop,
        chooseProjectPath: app.chooseProjectPath,
        chooseSavePath: app.chooseSavePath,
        setDockBadge: app.setDockBadge,
      });
      others.set(path, other);

      return other;
    },
    forProject: (path) => app.of(path),
    daemonProof: async () => {
      if (app.proof.failure) throw app.proof.failure;

      return app.proof.value;
    },
    chooseProjectPath: async () => app.chooser.path,
    chooseSavePath: async (suggestedName) => {
      app.chooser.suggestedNames.push(suggestedName);

      return app.chooser.savePath;
    },
    setDockBadge: async (count) => {
      app.badges.push(count);
    },
    rpc: async (method, params) => {
      app.calls.push({ method, params });

      const handler = app.handlers[method];

      if (!handler) throw new RpcError(METHOD_NOT_FOUND, `no handler for ${method}`);

      return handler(params);
    },
    subscribe: async (listener) => {
      onEvent = listener;
    },
    onFileDrop: async (listener) => {
      dropListeners.add(listener);

      return () => dropListeners.delete(listener);
    },
    onDaemonExited: async (listener) => {
      exitListeners.add(listener);

      return () => exitListeners.delete(listener);
    },
  };

  return app;
};
