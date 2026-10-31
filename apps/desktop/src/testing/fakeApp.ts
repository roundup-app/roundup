import { projectMenu } from "./menuProbe";
import type { Event as DaemonEvent } from "@contracts/Event";
import type { RpcMethodName, RpcMethods } from "@contracts/methods";
import { OWN_CONTRACT } from "../app/contractMatch";
import { RpcError } from "../app/seam";
import { menuProbe, probeQuestion, probeRemovalQuestion, questionProbe } from "./menuProbe";
import type { AppSeam, RemovalQuestion, RemovalAnswer, NativeOpen, NativeQuestion, DaemonExit, DaemonExited, FileDrop, MenuItem, OpenTarget, OutputMessage, PastedImage, Project, StateAlert } from "../app/seam";

const CONFLICT = -32003;

const METHOD_NOT_FOUND = -32601;

export type Handlers = {
  [M in RpcMethodName]?: (
    params: RpcMethods[M]["params"],
  ) => RpcMethods[M]["result"] | Promise<RpcMethods[M]["result"]>;
};

/** Reads the regions make once a Project is open answer empty; any other method fails with METHOD_NOT_FOUND until a test installs a handler. */
const emptyReads: Handlers = {
  "daemon.methods": () => OWN_CONTRACT.methods,
  "daemon.ping": () => ({ pong: true, pid: 1, project: "/project", projectKey: "project-0000000000000000", contract: { fingerprint: OWN_CONTRACT.fingerprint } }),
  "rail.tree": () => [],
  "agent.worktreeState": () => ({ ahead: 0, behind: 0, dirty: false }),
  "terminal.list": () => [],
  "workstream.queue": () => ({ entries: [], running: 0, cap: 1 }),
  "project.resources": () => ({ agents: [], total: { memory_bytes: 0, cpu_percent: 0, disk_bytes: null } }),
  "models.list": () => ({ engines: [{ id: "test-engine", label: "Claude Code" }], models: [{ id: "test-model", label: "Offered model" }], efforts: [] }),
  "terminal.scheme": () => null,
  "todo.list": () => [],
  "todo.unread": () => [],
  "todo.deletion": () => null,
  "todo.listHanded": () => [],
  "message.list": () => [],
  "pad.list": () => [],
  "ask.list": () => [],
  "reaction.list": () => [],
  "deliverable.list": () => [],
  "provenance.history": () => [],
  "message.progress": () => ({ instructions: { project: "/project", home: null, current: null, revisions: [], deliveries: [] }, results: [] }),
  "message.reconcileWork": ({ id }) => ({ agent: id, actions: [], blocked: [], context: [], pending_checks: [] }),
};

/** One `selectOutput` call: the listener stays here after `release`, so a test can call it late. */
export type FakeOutputSubscription = { id: string; offset: number; listener: (message: OutputMessage) => void; released: boolean };

export type FakeApp = AppSeam & {
  nativeOpen(request: NativeOpen): void;
  questions: NativeQuestion[];
  removalQuestions: RemovalQuestion[];
  answerRemoval: ((answer: RemovalAnswer) => void) | undefined;
  answerQuestion: ((answer: boolean) => void) | undefined;
  questionFailure: Error | null;
  /** Every `rpc` call so far, in call order. */
  calls: { method: RpcMethodName; params: unknown }[];
  handlers: Handlers;
  emit(event: DaemonEvent): void;
  /** Every `subscribe` call so far with the `after` it asked to replay from, and the `head` the Daemon answers. */
  subscribed: { after: number | undefined }[];
  head: number;
  /** Every `selectOutput` call so far, in call order. */
  outputSubscriptions: FakeOutputSubscription[];
  /** The next byte position of each Terminal's output stream; `selectOutput` starts there. Set it to start a stream mid-way. */
  outputPositions: Map<string, number>;
  /** What `selectOutput` rejects with while set. */
  outputFailure: RpcError | null;
  /** The Terminal prints `bytes`: they reach its live subscription only, and the stream moves on whether or not anyone listens. Returns the offset they start at. */
  emitBytes(id: string, bytes: Uint8Array): number;
  /** The Terminal prints `text` as UTF-8 bytes. */
  emitOutput(id: string, text: string): number;
  /** The live subscription of `id` was not given `from..to`; the stream resumes at `to`. */
  emitGap(id: string, from: number, to: number): void;
  /** Delivers the native owner's recovery state for `path` (the first Project by default). An omitted `recovery` represents exhausted retries, not the initial unexpected exit. */
  exitDaemon(exit: DaemonExit, path?: string): void;
  /** Every path `close_project` was called for, in order. */
  closed: string[];
  /** Delivers one File drop step to every listener, as the native window would. */
  dropFiles(drop: FileDrop): void;
  /** Every target `open_target` was called with, in order; `openFailure` is what it rejects with. */
  openedTargets: OpenTarget[];
  openFailure: RpcError | null;
  /** Every path `open_in_editor` was called with, in order; `editorFailure` is what it rejects with. */
  editorOpened: string[];
  /** The same calls with their `line`. */
  editorCalls: { path: string; line?: number }[];
  editorFailure: RpcError | null;
  /** Every menu `show_context_menu` was called with, in order; `menuChoice` is the id it resolves (`null`: the menu closed with no choice). */
  shownMenus: { items: MenuItem[]; x: number; y: number }[];
  /** `undefined`: the menu stays open until `pickMenu` or `closeMenu`. */
  menuChoice: string | null | undefined;
  menuResolve: ((id: string | null) => void) | null;
  /** Chooses the item labelled `label` (a submenu's child included) of the open menu, and lets the webview run it. */
  pickMenu(label: string): Promise<void>;
  closeMenu(): Promise<void>;
  /** The labels of the last menu shown, top level, with `enabled` when asked. */
  menuLabels(): string[];
  /** Every image `save_pasted_image` was called with, in order; `saveImageFailure` is what it rejects with and `savedImagePath` what it resolves. */
  savedImages: PastedImage[];
  clipboardWrites: string[];
  /** Native write edge, kept live through App decorators; tests can replace it after mounting. */
  clipboardWrite(text: string): Promise<void>;
  clipboardFailure: Error | null;
  saveImageFailure: RpcError | null;
  savedImagePath: string;
  /** What the macOS chooser answers; `null` is a cancel. */
  chooser: { path: string | null; savePath: string | null; suggestedNames: string[] };
  /** Recorded window operations; a title handler can reject or hold a write pending. */
  windowOperations: ({ kind: "title"; title: string } | { kind: "drag" } | { kind: "zoom" })[];
  windowTitleHandler: ((title: string) => Promise<void>) | null;
  /** Every Dock badge count set so far, in order. */
  badges: number[];
  /** Every `stateAlert` call in order, and the rejection the next ones fail with. */
  stateAlerts: StateAlert[];
  stateAlertFailure: RpcError | null;
  /** Emits `state-alert-clicked` for the Agent, as a click on its banner does. */
  clickStateAlert(agent: string): void;
  /** The first open Project (setting it makes it the only one open), or the error `open_project` fails with. */
  opened: { project: Project | null; failure: RpcError | null };
  /** Opens another Project beside those open, as `open_project` does, and returns its name and path. */
  add(path: string, name?: string): Project;
  /** The fake Daemon of one open Project: `app` itself for the first, and one with its own calls, handlers, events for any other (S8). */
  of(path: string): FakeApp;
};

const folderOf = (path: string): string => path.split("/").pop() ?? path;

export const createFakeApp = (): FakeApp => {
  const nativeListeners = new Set<(request: NativeOpen) => void>();
  let onEvent: ((event: DaemonEvent) => void) | null = null;
  const live = new Map<string, FakeOutputSubscription>();
  const alertClicks = new Set<(agent: string) => void>();
  const exitListeners = new Set<(exit: DaemonExited) => void>();
  const exited = new Set<string>();
  const dropListeners = new Set<(drop: FileDrop) => void>();
  let open: Project[] = [];
  let primary: string | null = null;
  const others = new Map<string, FakeApp>();

  const nameAt = (path: string): string => open.find((project) => project.path === path)?.name ?? folderOf(path);

  let naming = { automaticRenaming: true, namingGuide: "Use three hyphen-separated words: role-verb-object, within 32 characters." };

  const app: FakeApp = {
    recentProjects: async () => [],
    claudeBinary: async () => ({ path: "/fake/claude", version: "1.0.0" }),
    onNativeOpen: async listener => {
      nativeListeners.add(listener);

      return () => { nativeListeners.delete(listener); };
    },
    nativeOpen: request => nativeListeners.forEach(listener => listener(request)),
    calls: [],
    handlers: { ...emptyReads,
      "daemon.getNaming": () => ({ ...naming }),
      "daemon.setNaming": params => {
        if (!params.namingGuide.trim()) throw new RpcError(-32602, "Enter a naming guide before saving.");
        naming = { ...params };

        return null;
      },
    },
    chooser: { path: null, savePath: null, suggestedNames: [] },
    badges: [],
    stateAlerts: [],
    stateAlertFailure: null,
    clickStateAlert: agent => { for (const listener of alertClicks) listener(agent); },
    windowOperations: [],
    windowTitleHandler: null,
    openedTargets: [],
    openFailure: null,
    editorOpened: [],
    editorCalls: [],
    editorFailure: null,
    clipboardWrites: [],
    clipboardFailure: null,
    writeClipboardText: (text) => app.clipboardWrite(text),
    clipboardWrite: async (text) => {
      if (app.clipboardFailure) throw app.clipboardFailure;
      app.clipboardWrites.push(text);
    },
    savedImages: [],
    shownMenus: [],
    menuChoice: undefined,
    menuResolve: null,
    pickMenu: async (label) => {
      const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((item) => [item, ...flat(item.children ?? [])]);
      const found = flat(app.shownMenus.at(-1)?.items ?? []).find((item) => item.label === label);

      if (!found) throw new Error(`no menu item ${label}`);

      if (!found.children && found.enabled) app.menuResolve?.(found.id);
      await new Promise((done) => setTimeout(done, 0));
    },
    closeMenu: async () => {
      app.menuResolve?.(null);
      await new Promise((done) => setTimeout(done, 0));
    },
    menuLabels: () => (app.shownMenus.at(-1)?.items ?? []).map((item) => item.label),
    saveImageFailure: null,
    savedImagePath: "/Users/me/Library/Caches/roundup-pasted/pasted-1-abcd1234.png",
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
    subscribed: [],
    head: 0,
    emit: (event) => {
      if (!onEvent) throw new Error("the webview has not subscribed yet");

      onEvent(event);
    },
    outputSubscriptions: [],
    outputPositions: new Map(),
    outputFailure: null,
    emitBytes: (id, bytes) => {
      const offset = app.outputPositions.get(id) ?? 0;

      app.outputPositions.set(id, offset + bytes.length);
      live.get(id)?.listener(bytes);

      return offset;
    },
    emitOutput: (id, text) => app.emitBytes(id, new TextEncoder().encode(text)),
    emitGap: (id, from, to) => {
      app.outputPositions.set(id, to);
      live.get(id)?.listener({ gap: { from, to } });
    },
    closed: [],
    exitDaemon: (exit, path) => {
      const named = path ?? open[0]?.path ?? "";

      if (exit.recovery === "connecting") exited.delete(named);
      else exited.add(named);

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
    renameProject: async (path, name, base) => {
      if (!open.some((project) => project.path === path)) throw new RpcError(CONFLICT, `${path} is not open`);

      if (base !== undefined && open.find(project => project.path === path)?.name !== base) throw new RpcError(CONFLICT, "Project name changed");
      const trimmed = name.trim();

      if (name.includes("\n") || name.includes("\r") || Array.from(trimmed).length > 40) throw new RpcError(-32602, "invalid Project name");
      const renamed = { name: trimmed || folderOf(path), path };

      open = open.map((project) => (project.path === path ? renamed : project));

      return renamed;
    },
    of: (path) => {
      primary ??= path;

      if (path === primary) return app;

      const existing = others.get(path);

      if (existing) return existing;

      const other = createFakeApp();
      other.handlers["daemon.getNaming"] = () => app.rpc("daemon.getNaming", null);
      other.handlers["daemon.setNaming"] = params => app.rpc("daemon.setNaming", params);

      // The Project-wide calls are the one App's; only the Daemon's own calls, events are this Project's.
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
        imageUrl: app.imageUrl,
        chooseProjectPath: app.chooseProjectPath,
        chooseSavePath: app.chooseSavePath,
        ask: app.ask,
        askRemoval: app.askRemoval,
        setDockBadge: app.setDockBadge,
        stateAlert: app.stateAlert,
        onStateAlertClicked: app.onStateAlertClicked,
        setWindowTitle: app.setWindowTitle,
        dragWindow: app.dragWindow,
        zoomWindow: app.zoomWindow,
        windowOperations: app.windowOperations,
        openTarget: app.openTarget,
        openInEditor: app.openInEditor,
        savePastedImage: app.savePastedImage,
        writeClipboardText: (text: string) => app.writeClipboardText(text),
        clipboardWrites: app.clipboardWrites,
        showContextMenu: app.showContextMenu,
      });
      Object.defineProperty(other, "windowTitleHandler", {
        get: () => app.windowTitleHandler,
        set: (handler: FakeApp["windowTitleHandler"]) => { app.windowTitleHandler = handler; },
      });
      others.set(path, other);

      return other;
    },
    forProject: (path) => app.of(path),
    removalQuestions: [],
    answerRemoval: undefined,
    askRemoval: async question => {
      app.removalQuestions.push(question);

      if (app.questionFailure) throw app.questionFailure;
      const answer = probeRemovalQuestion(question);
      app.answerRemoval = chosen => questionProbe.answer?.(chosen);

      return answer;
    },
    questions: [],
    answerQuestion: undefined,
    questionFailure: null,
    ask: async (question) => {
      app.questions.push(question);

      if (app.questionFailure) throw app.questionFailure;
      const answer = probeQuestion(question);
      app.answerQuestion = accepted => questionProbe.answer?.(accepted);

      return answer;
    },
    chooseProjectPath: async () => app.chooser.path,
    chooseSavePath: async (suggestedName) => {
      app.chooser.suggestedNames.push(suggestedName);

      return app.chooser.savePath;
    },
    setDockBadge: async (count) => {
      app.badges.push(count);
    },
    stateAlert: async (alert) => {
      app.stateAlerts.push(alert);

      if (app.stateAlertFailure) throw app.stateAlertFailure;
    },
    onStateAlertClicked: async (listener) => {
      alertClicks.add(listener);

      return () => alertClicks.delete(listener);
    },
    setWindowTitle: async (title) => {
      app.windowOperations.push({ kind: "title", title });
      await app.windowTitleHandler?.(title);
    },
    dragWindow: async () => { app.windowOperations.push({ kind: "drag" }); },
    zoomWindow: async () => { app.windowOperations.push({ kind: "zoom" }); },
    rpc: async (method, params) => {
      app.calls.push({ method, params });

      const handler = app.handlers[method];

      if (!handler) throw new RpcError(METHOD_NOT_FOUND, `no handler for ${method}`);

      return handler(params);
    },
    subscribe: async (listener, after) => {
      onEvent = listener;
      app.subscribed.push({ after });

      return app.head;
    },
    selectOutput: async (id, listener) => {
      if (app.outputFailure) throw app.outputFailure;

      const subscription: FakeOutputSubscription = { id, offset: app.outputPositions.get(id) ?? 0, listener, released: false };

      app.outputSubscriptions.push(subscription);
      live.set(id, subscription);

      return {
        offset: subscription.offset,
        release: async () => {
          subscription.released = true;

          if (live.get(id) === subscription) live.delete(id);
        },
      };
    },
    imageUrl: (path) => `file://${path}`,
    openTarget: async (target) => {
      if (app.openFailure) throw app.openFailure;

      app.openedTargets.push(target);
    },
    openInEditor: async (path, line) => {
      if (app.editorFailure) throw app.editorFailure;

      app.editorOpened.push(path);
      app.editorCalls.push(line === undefined ? { path } : { path, line });
    },
    showContextMenu: async (items, x, y) => {
      app.shownMenus.push({ items, x, y });
      menuProbe.shown = items;
      menuProbe.count += 1;

      if (app.menuChoice !== undefined) return app.menuChoice;

      return new Promise<string | null>((resolve) => { app.menuResolve = resolve; menuProbe.answer = resolve; });
    },
    savePastedImage: async (image) => {
      if (app.saveImageFailure) throw app.saveImageFailure;

      app.savedImages.push(image);

      return app.savedImagePath;
    },
    onFileDrop: async (listener) => {
      dropListeners.add(listener);

      return () => dropListeners.delete(listener);
    },
    selectProjectMenu: async (path, items) => { projectMenu.path = path; projectMenu.items = items ?? []; },
    onProjectPage: async (listener) => {
      const receive = (event: Event) => { if (event instanceof CustomEvent) listener(event.detail); };

      window.addEventListener("open-project-page", receive);

      return () => window.removeEventListener("open-project-page", receive);
    },
    onAppSettings: async (listener) => {
      window.addEventListener("open-app-settings", listener);

      return () => window.removeEventListener("open-app-settings", listener);
    },
    onDaemonExited: async (listener) => {
      exitListeners.add(listener);

      return () => exitListeners.delete(listener);
    },
  };

  return app;
};
