import type { Event as DaemonEvent } from "@contracts/Event";
import type { RpcMethodName, RpcMethods } from "@contracts/methods";
import { RpcError } from "../app/seam";
import type { AppSeam, DaemonExit, DaemonExited, FileDrop, Project } from "../app/seam";

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
  /** The one Project `projects` lists and `open_project` answers, or the error `open_project` fails with. */
  opened: { project: Project | null; failure: RpcError | null };
  /** What `daemon_proof` answers, or the error it fails with (H18). */
  proof: { value: string; failure: RpcError | null };
};

export const createFakeApp = (): FakeApp => {
  let onEvent: ((event: DaemonEvent) => void) | null = null;
  const exitListeners = new Set<(exit: DaemonExited) => void>();
  let exited = false;
  const dropListeners = new Set<(drop: FileDrop) => void>();

  const app: FakeApp = {
    calls: [],
    handlers: { ...emptyReads },
    chooser: { path: null, savePath: null, suggestedNames: [] },
    badges: [],
    opened: { project: null, failure: null },
    proof: { value: "fake-proof", failure: null },
    emit: (event) => {
      if (!onEvent) throw new Error("the webview has not subscribed yet");

      onEvent(event);
    },
    closed: [],
    exitDaemon: (exit, path) => {
      exited = true;

      for (const listener of exitListeners) listener({ path: path ?? app.opened.project?.path ?? "", ...exit });
    },
    dropFiles: (drop) => {
      for (const listener of dropListeners) listener(drop);
    },
    projects: async () => (app.opened.project ? [{ ...app.opened.project, running: !exited }] : []),
    openProject: async (path) => {
      if (app.opened.failure) throw app.opened.failure;

      exited = false;
      app.opened.project = { name: path.split("/").pop() ?? path, path };

      return app.opened.project;
    },
    closeProject: async (path) => {
      app.closed.push(path);

      if (app.opened.project?.path === path) app.opened.project = null;
    },
    renameProject: async (path, name) => {
      const folder = path.split("/").pop() ?? path;

      app.opened.project = { name: name.trim() || folder, path };

      return app.opened.project;
    },
    forProject: () => app,
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
