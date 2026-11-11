import pRetry from "p-retry";
import { createProjectOpening, ProjectOpening } from "./window/ProjectOpening";
import { historyRegion, returnFocus } from "./keys/focus";
import { focusPane } from "./bubbles/focus";
import Hourglass from "lucide-solid/icons/hourglass";
import { ReducedMotionContext } from "./app/reducedMotion";
import { pressFeedback } from "./ui/pressFeedback";
import { storageCopy } from "./app/copy";
import { storageProblems } from "./state/storage";
import "./state/storage.css";
import { textTarget } from "./ui/contextMenu";
import { AppSettings } from "./settings/AppSettings";
import { createSettingsView } from "./state/settingsView";
import { applyConfig } from "./settings/configApply";
import { appSettings, applyAppAppearance } from "./settings/preferences";
import { captureActions, registerKeys } from "./keys/registry";
import { Combobox } from "./ui/Combobox";
import { CHORDS, LEADER, leaderKeys, shortcutLabel } from "./keys/chords";
import { copy } from "./app/copy";
import "./buttons.css";
import { batch, lazy, createEffect, createMemo, createResource, createSignal, createUniqueId, For, getOwner, on, onCleanup, onMount, runWithOwner, Show, untrack } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { ChooseProject, EmptyRail, EmptyShelf } from "./window/FirstRun";
import { Layout } from "./window/Layout";
import { createWindowFocus } from "./window/focus";
import { createMenuWriter, projectMenuItems, TEXT_FIELD, undoAction, watchMenuBar } from "./window/menuBar";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Tabs } from "./ui/Tabs";
import { Reopen } from "./window/Reopen";
import { createDropTargets } from "./window/dropTargets";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Requested } from "@contracts/project/Requested";
import type { OpenRequest } from "./window/nativeOpen";
import type { App as AppCalls, DaemonExit, MenuItem, ActionRequest, ActionReply, Project } from "./app/seam";
import { DrawerHost } from "./drawer/DrawerHost";
import { InboxKey } from "./inbox/Inbox";
import { WindowBar } from "./header/WindowBar";
import { Strip } from "./header/Strip";
import type { StripTab } from "./header/tab";
import { ReservedLine } from "./ink/ReservedLine";
import { dismissable, failureLine } from "./ink/ReservedLine";
import { exitText } from "./ink/exitText";
import { AttentionKey } from "./rail/AttentionKey";
import { attentionCounts, attentionHolders, nextAttention } from "./rail/attention";
import { DockBadge } from "./rail/DockBadge";
import { createProjectAlerts } from "./state/projectAlerts";
import type { ProjectAlerts } from "./state/projectAlerts";
import { createStateAlerts } from "./rail/stateAlerts";
import type { StateAlerts } from "./rail/stateAlerts";
import { railStorage } from "./rail/persist/storage";
import { Rail } from "./rail/Rail";
import { createRailPeek } from "./rail/peek";
import { createRailSlide } from "./rail/slide";
import { ProjectSettingsView } from "./rail/ProjectSettings";
import { Help } from "./keys/Help";
import { Leader } from "./keys/Leader";
import type { LinkContent } from "@contracts/link/LinkContent";
import { Capture } from "./todos/Capture";
import { createNow, DisplayClockContext } from "./state/clock";
import type { Clock } from "./state/clock";
import { createProjectsState } from "./state/projects";
import type { OpenTab } from "./state/projects";
import { createProjectDrafts, connectProject, ConnectedProjectContext, ProjectDraftsContext } from "./state/connectedProject";
import type { ConnectedProject } from "./state/connectedProject";
import { lazyXtermEmulators } from "./terminal/lazyEmulator";
import type { EmulatorFactory } from "./terminal/emulator";
import { webChime } from "./toasts/chime";
import type { Chime } from "./toasts/chime";
import { createToastQueue } from "./toasts/queue";
import type { ToastQueue } from "./toasts/queue";
import { Toasts } from "./toasts/Toasts";
import { watchProject } from "./toasts/watch";
import { Bubbles } from "./bubbles/Bubbles";
import { AskBar } from "./ask/AskBar";
import { Switcher } from "./switcher/Switcher";
import { Feedback } from "./feedback/Feedback";
import { Pane } from "./terminal/Pane";
import type { Screens } from "./terminal/screens";
import { ResourceStrip } from "./resources/ResourceStrip";
import { createShelfFrame } from "./shelf/frame";
import { Shelf, createShelfTabs, ShelfTabs, ProjectShelfTabs } from "./shelf/Shelf";
import { shelfKeys } from "./shelf/keys";
import { createEdgePeek } from "./ui/edgePeek";
import { createWidths } from "./resize/widths";
import { RailStrip } from "./rail/RailStrip";

const ForkSheet = lazy(() => import("./fork/ForkSheet").then(module => ({ default: module.ForkSheet })));

const TodoHost = lazy(() => import("./todos/TodoDrawer").then(module => ({ default: module.TodoHost })));

const PadHost = lazy(() => import("./pads/PadDrawer").then(module => ({ default: module.PadHost })));

const daemonExitText = ({ code, recovery, cause }: DaemonExit): string | null =>
  recovery ? null : cause ?? copy.daemonExit(exitText(code === null ? { kind: "signal" } : { kind: "code", code }));

const linkedItem = (content: LinkContent, onLateFailure: (message: string) => void) =>
  content.kind === "pad" ? <PadHost name={content.id} heading={content.section?.heading} onLateFailure={onLateFailure} />
    : content.kind === "todo" ? <TodoHost id={content.todo.id} /> : null;

const RUNNING = new Set(["working", "needs-you", "blocked"]);

type Connections = ReadonlyMap<string, ConnectedProject | Error>;

/** One Project's live connection to its Daemon, kept while its tab is open and its regions are not on screen, so its Tab mark stays current (U181). */
const Connection = (props: {
  app: AppCalls;
  tab: () => OpenTab | undefined;
  reducedMotion: Accessor<boolean>;
  now: Accessor<number>;
  clock: Clock;
  drafts: ReturnType<typeof createProjectDrafts>;
  onConnected: (path: string, connection: ConnectedProject | Error | null) => void;
  onRecovered: (path: string, generation: number) => void;
  onRequested: (request: Requested) => void;
  onOpen: (request: Extract<ActionRequest, { method: "project.open" | "project.start" }>, signal: AbortSignal) => Promise<ActionReply>;
  toasts: ToastQueue;
  alerts: StateAlerts;
  /** U6220d: the open Project's alert level. */
  projectAlerts: () => ProjectAlerts;
  active: () => boolean;
  /** U3566: this Project is on screen in a visible, focused window. */
  viewing: () => boolean;
  show: () => void;
  /** U6271a: every open Project, so a placed part reaches its own Daemon. */
  open: () => readonly Project[];
  /** U6271c: another Project's Rail nodes, and showing it with one of its Workstreams selected. */
  nodes: (path: string) => readonly RailNode[];
  openIn: (path: string, workstream: string) => void;
}) => {
  const first = props.tab();

  if (!first) return null;

  const { path } = first.project;
  let mine: ConnectedProject | Error | undefined;
  let registration = new AbortController();
  onCleanup(() => registration.abort());
  createEffect(() => { if (props.tab()?.exit) registration.abort(); });

  const [connected] = createResource(() => props.tab()?.generation, async (generation) => {
    const exit = props.tab()?.exit;

    try {
      registration.abort();
      registration = new AbortController();
      const captured = registration;
      const calls = props.app.forProject(path);

      const next = await connectProject({ ...calls, serveActions: async (answer, invalidated) => {
        await calls.serveActions?.(request => (request.method === "project.open" || request.method === "project.start")
          ? props.onOpen(request, captured.signal) : answer(request), () => { captured.abort(); invalidated?.(); });
      } }, first.project, props.reducedMotion, props.now, () => props.tab()?.generation === generation ? props.tab()?.exit ?? null : { code: null, recovery: "connecting" }, railStorage(path), props.drafts(path), props.viewing, props.clock, { app: props.app, open: props.open, nodes: props.nodes, show: props.openIn });

      if (props.tab()?.generation !== generation) {
        next.stopTerminalScheme();

        return mine;
      }

      // Clearing a newer exit would hide its Reopen action.
      if (props.tab()?.exit === exit) props.onRecovered(path, generation);

      return next;
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;

      return failure;
    }
  });

  createEffect(() => {
    const next = connected.latest;

    // A failed replacement keeps the last valid content while the native owner retries.
    if (next instanceof Error && props.tab()?.exit) return;

    mine = next;

    if (mine) props.onConnected(path, mine);
  });

  createEffect(() => {
    const open = connected();

    if (open && !(open instanceof Error)) open.worktrees.watch(props.active);
  });

  // M8: rename keeps its request Event; open completes through the registered App relay.
  createEffect(() => {
    const open = connected();

    if (!open || open instanceof Error) return;

    // MC40, MC41: the owner's look and keys files, read on connect and on each save; the App's own refusal of keys shows as the Daemon's problems do.
    const toasts = props.toasts;

    const config = () => void applyConfig(open.app, (file, cause) => {
      const item = `config:${file}:${cause}`;

      toasts.push({ key: item, item, kind: "error", name: file, line: cause, selected: false, open: () => null, project: path });
    });

    config();

    const stop = open.events.subscribe((event) => {
      if (event.name === "project.requested") props.onRequested(event.data);
      else if (event.name === "config.changed") config();
    });

    onCleanup(stop);
  });

  // U410: the Events of this Project that make a Toast.
  createEffect(() => {
    const open = connected();

    if (!open || open instanceof Error) return;

    // Untracked: watchProject reads the Rail's nodes, and each Status change would else rebuild the watch with that change already seen.
    onCleanup(untrack(() => watchProject(open, props.toasts.push, props.show, props.active, props.toasts.settle, props.alerts, props.toasts.suppress, props.projectAlerts)));
  });

  createEffect(() => {
    const open = connected();

    if (open && !(open instanceof Error)) onCleanup(open.stopTerminalScheme);
  });

  onCleanup(() => {
    if (mine) props.onConnected(path, null);
  });

  return null;
};

/** Project regions show loading until their connection is ready, and failure if setup fails. */
const InProject = (props: { open: ConnectedProject | Error | undefined; failed?: (failure: Error) => JSX.Element; pending?: JSX.Element; children: (open: ConnectedProject) => JSX.Element }) => (
  <Show when={props.open} keyed fallback={props.pending}>
    {(open) =>
      open instanceof Error ? (
        props.failed?.(open)
      ) : (
        <ConnectedProjectContext.Provider value={open}>{props.children(open)}</ConnectedProjectContext.Provider>
      )
    }
  </Show>
);

// The fold helper loads after mount so Motion's layout projection stays out of the entry bundle (R3800).
const documentMotion = (reducedMotion: Accessor<boolean>) => {
  const stopPress = pressFeedback(document);
  const fold = import("./ui/fold").then(({ foldMotion }) => foldMotion(document, reducedMotion));

  return () => {
    stopPress();
    void fold.then(stop => stop());
  };
};

export const App = (props: {
  app: AppCalls;
  reducedMotion: Accessor<boolean>;
  clock: Clock;
  createEmulator?: EmulatorFactory | undefined;
  prepareIdle?: ((project: ConnectedProject) => void) | undefined;
  initialShelfOpen?: boolean;
  observeTerminal?: ((project: string | null, id: string | null) => void) | undefined;
  /** U410: the Toast sound; the webview's own by default. */
  chime?: Chime | undefined;
  /** App-run draft authority; embedding callers may supply the same holder to surface owners. */
  drafts?: ReturnType<typeof createProjectDrafts>;
}) => {
  const clearBrowserSelection = (event: MouseEvent) => {

    if (event.button !== 0 || event.ctrlKey) return;

    // Crepe owns its selection while a formatting control runs.
    if (event.target instanceof Element && event.target.closest(".pad-rich-editor")) return;

    window.getSelection()?.removeAllRanges();
    const editing = document.activeElement;

    if ((editing instanceof HTMLInputElement || editing instanceof HTMLTextAreaElement)
      && editing !== event.target && editing.selectionStart !== null) {
      editing.setSelectionRange(editing.selectionEnd, editing.selectionEnd);
    }
  };

  const suppressBrowserMenu = (event: MouseEvent) => {
    if (!textTarget(event.target)) event.preventDefault();
  };

  onMount(() => onCleanup(documentMotion(props.reducedMotion)));
  makeEventListener(window, "contextmenu", suppressBrowserMenu);
  makeEventListener(window, "pointerdown", clearBrowserSelection, true);

  applyAppAppearance();
  const projects = createProjectsState(props.app);
  const settingsView = createSettingsView();
  const settingsOpen = settingsView.open;
  const drafts = props.drafts ?? createProjectDrafts();
  registerKeys({ kind: "app" }, ["⌘Z", "⇧⌘Z"].map(keys => ({
    action: CHORDS[keys === "⌘Z" ? "edit.undo" : "edit.redo"],
    when: () => !document.activeElement?.closest(TEXT_FIELD),
    capture: focus => {
      const path = projects.active();
      const undo = undoAction(path ? drafts(path).todoUndo : null, keys === "⇧⌘Z", focus);

      return {
        available: () => path !== null && projects.active() === path && undo.available && !focus?.closest(TEXT_FIELD),
        label: undo.label,
        invoke: undo.run,
      };
    },
  })));
  const tabsId = createUniqueId();
  const [connections, setConnections] = createSignal<Connections>(new Map());
  const { focus, setFocus, menuFocus, visible } = createWindowFocus();

  const isWorking = () => projects.tabs().some((tab) => {
    const connection = connections().get(tab.project.path);

    return !tab.exit && connection && !(connection instanceof Error)
      && connection.rail.nodes.some((node) => node.status?.kind === "working");
  });

  const now = createNow(props.clock, isWorking, visible);
  // Display demand must not enable the Worktree RPC cadence.
  const pollingNow = createMemo<number>((previous) => visible() && isWorking() ? now() : previous ?? untrack(now));
  // U413: roundup is in front while its window has focus and is visible.
  const inFront = () => document.hasFocus() && document.visibilityState === "visible";
  const toasts = createToastQueue(inFront, props.chime ?? webChime());
  const [jumpFailure, setJumpFailure] = createSignal<string | null>(null);
  const [windowFailure, setWindowFailure] = createSignal<string | null>(null);
  /** U6249d: a failure of OS integration (Dock badge, State alert, menu bar) is not the user's to act on; the log holds its cause and the screen shows nothing. */
  const hide = (cause: string) => console.error(cause);
  // U5541: a failed publication read keeps its line; the menu bar's own refusals go to the log.
  const [menuBarFailure, setMenuBarFailure] = createSignal<string | null>(null);
  const railFailure = () => windowFailure() ?? (activeTab()?.exit ? activeTab()?.reopenFailure ?? daemonExitText(activeTab()!.exit!) : null) ?? (projects.tabs().length > 0 ? projects.failure() : null) ?? menuBarFailure();
  const railLine = dismissable(railFailure);
  const storageLine = dismissable(() => storageFailures().length > 0 ? storageCopy.failure(storageFailures()) : null);
  const alerts = createStateAlerts(alert => props.app.stateAlert(alert), inFront, cause => { if (cause !== null) hide(cause); });
  const projectAlerts = createProjectAlerts();
  const capture = props.app.capture;
  onMount(() => {
    // U6249d: C1 retries twice, at 0.5 s and 2 s, then goes to the log.
    if (capture) void pRetry(() => capture.configure(appSettings().quickAddAnywhere || null), { retries: 2, minTimeout: 500, factor: 4 }).catch(error => hide(String(error)));
  });
  onCleanup(() => { void capture?.configure(null); });

  createEffect(on(projects.active, () => setJumpFailure(null), { defer: true }));

  const connect = (path: string, connection: ConnectedProject | Error | null) =>
    setConnections((all) => {
      const next = new Map(all);

      if (connection) next.set(path, connection);
      else next.delete(path);

      return next;
    });

  // Keep the last connection visible until its replacement has finished setup.
  const keys = createMemo(() => projects.tabs().map((tab) => tab.project.path));

  const [renamingProjects, setRenamingProjects] = createSignal<ReadonlyMap<string, { name: string; revision: number }>>(new Map());
  let renameRevision = 0;

  const renameProject = async (path: string, name: string, base?: string) => {
    const before = renamingProjects().get(path)?.name ?? projects.tabs().find((tab) => tab.project.path === path)?.project.name;

    const revision = ++renameRevision;
    setRenamingProjects((all) => new Map(all).set(path, { name: before ?? name, revision }));
    const outcome = await projects.rename(path, name, base);

    if (renamingProjects().get(path)?.revision !== revision) return outcome;
    setRenamingProjects((all) => {
      const next = new Map(all);
      next.delete(path);

      return next;
    });

    return outcome;
  };

  const opening = createProjectOpening(projects, path => props.app.forProject(path));
  const answer = (request: Requested) => void renameProject(request.path, request.name);

  const tabOf = (path: string) => () => projects.tabs().find((tab) => tab.project.path === path);

  const railOf = (path: string): ConnectedProject["rail"] | undefined => {
    const connection = connections().get(path);

    return connection instanceof Error ? undefined : connection?.rail;
  };

  const connectionOf = (path: string): ConnectedProject | undefined => {
    const connection = connections().get(path);

    return connection instanceof Error ? undefined : connection;
  };

  const [nativeFailure, setNativeFailure] = createSignal<{ message: string; action?: { label: string; run: () => void } } | null>(null);
  const failNative = (message: string | null, action?: { label: string; run: () => void }) => setNativeFailure(message === null ? null : action ? { message, action } : { message });
  let nativeHandler: Promise<(request: OpenRequest) => void> | undefined;
  const routeNativeOpen = (request: OpenRequest) => void nativeHandler?.then(handle => handle(request)).catch(error => failNative(String(error)));
  onMount(() => {
    const owner = getOwner();
    nativeHandler = import("./window/nativeOpen").then(({ watchNativeOpen }) => runWithOwner(owner, () => watchNativeOpen({ solid: { createEffect, createSignal, onCleanup }, app: props.app, projects, connectionOf, item: linkedItem, fail: failNative }))!);
    const stop = props.app.onNativeOpen?.(routeNativeOpen, cause => failNative(cause));

    if (stop) onCleanup(stop);
  });

  untrack(() => watchMenuBar({
    solid: { createEffect, createSignal, onCleanup }, app: props.app, tabs: projects.tabs,
    connection: connectionOf, open: () => setFocus("menu"),
    select: (path, agent) => batch(() => {
      settingsView.close(false);
      connectionOf(path)!.settingsView.close(false);
      railOf(path)!.select(agent);
      projects.select(path);
      setFocus(document.hasFocus() ? "focused" : "blurred");
    }),
    fail: setMenuBarFailure, hide,
  }));

  const stripTabs = createMemo<StripTab[]>(() =>
    projects.tabs().map((tab) => {
      const nodes = railOf(tab.project.path)?.nodes ?? [];

      return {
        path: tab.project.path,
        name: tab.project.name,
        base: projects.base(tab.project.path),
        exitText: tab.exit ? daemonExitText(tab.exit) : null,
        busy: !connections().has(tab.project.path),
        ...attentionCounts(attentionHolders(nodes, railOf(tab.project.path)?.terminals() ?? [], railOf(tab.project.path)?.dismissed)),
        running: nodes.flatMap((node) => (node.status && RUNNING.has(node.status.kind) ? [node.name] : [])),
      };
    }),
  );

  // U348: a drag of files over the window; the Projects' regions hear the drops it lets through.
  const dropTargets = createDropTargets(props.app, { rail: () => railOf(projects.active() ?? ""), select: projects.select });
  onCleanup(dropTargets.start());

  const activeTab = createMemo(() => projects.tabs().find((tab) => tab.project.path === projects.active()));

  const activeConnection = createMemo(() => {
    const path = projects.active();

    return path === null ? undefined : connections().get(path);
  });

  const [captureConnection, setCaptureConnection] = createSignal<ConnectedProject>();
  const captureOwner = () => captureConnection() ?? activeConnection();

  const [captureShow, setCaptureShow] = createSignal<() => void>();
  const [capturePending, setCapturePending] = createSignal(false);
  const [captureChoosing, setCaptureChoosing] = createSignal(false);

  const openCapture = async () => {
    if (captureChoosing()) return;

    if (projects.active() === null) {
      setCaptureChoosing(true);
      await projects.choose();
      setCaptureChoosing(false);

      if (projects.active() === null) return;
    }

    setCapturePending(true);
  };

  createEffect(() => {
    const show = captureShow();

    if (!capturePending() || !show) return;
    setCapturePending(false);
    show();
  });
  createEffect(() => registerKeys({ kind: "app" }, [{
    action: CHORDS["todo.capture"],
    capture: () => ({
      available: () => !captureChoosing() && (projects.active() === null || connectionOf(projects.active()!)?.daemonExit() === null),
      invoke: () => void openCapture(),
    }),
  }]));

  const storageFailures = createMemo(() => {
    const open = activeConnection();
    const railKey = open && !(open instanceof Error) ? `roundup:rail:${open.project.path}` : null;

    return storageProblems().filter(problem => problem.key !== railKey);
  });

  createEffect(() => {
    if (!props.prepareIdle) return;

    const open = activeConnection();

    if (open && !(open instanceof Error)) props.prepareIdle(open);
  });

  // U370, U373: the Shelf's open state and open tab, kept per Project.
  const shelfElement = () => document.querySelector<HTMLElement>(".shelf");
  const frame = createShelfFrame(projects.active, props.reducedMotion, () => void shelfElement()?.offsetWidth, props.initialShelfOpen ?? false);
  createEffect(() => {
    const connected = activeConnection();
    const request = connected && !(connected instanceof Error) ? connected.creation() : null;

    if (!request || request.kind === "terminal") return;
    frame.setTab(request.kind === "todo" ? "todos" : "pads");

    if (!frame.open()) frame.toggle("key");
  });
  // U4457: a Rail Agent's Pads control opens the Shelf where `⌘K B` does, on the Pads tab.
  createEffect(() => {
    const connected = activeConnection();

    if (!connected || connected instanceof Error || connected.padsRequest() === null) return;
    frame.setTab(connected.padsTab());

    if (!frame.open()) frame.toggle("key");
  });
  const widths = createWidths(projects.active);

  // U6228: the Rail folds to a strip of Workstream marks; focus follows the control the user pressed, and `⌘K R` toggles it.
  const railSlide = createRailSlide(widths, () => props.reducedMotion());

  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.rail"], capture: () => ({
    available: () => activeConnection() != null,
    invoke: () => railSlide.set(!widths.collapsed(), "key"),
  }) }]);
  const railToggle = () => projects.tabs().length > 0 ? { collapsed: widths.collapsed(), onToggle: () => railSlide.set(!widths.collapsed(), "click") } : undefined;
  const railPeeking = createRailPeek(widths.collapsed, () => document.querySelector(".rail"));
  const shelfTabs = createShelfTabs(frame);
  const shelfFocus = shelfKeys({ frame, shelf: shelfElement });
  // U6224: the bar tabs promote through their own click; counting their press as use would let that click close what it just opened.
  createEdgePeek({ edge: "trailing", region: shelfElement, state: frame, promote: (target) => { if (!target.closest(".shelf-tabs")) frame.promote(); } });

  const views = [
    ["resources", copy.resources],
    ["made", copy.deliverables], ["notes", copy.recoverNotes],
  ] as const;

  const nativeMenu = createMemo(() => {
    menuFocus();
    const connected = activeConnection();
    const path = projects.active();

    return { path, items: projectMenuItems(menuFocus(), connected !== undefined && !(connected instanceof Error), path ? drafts(path).todoUndo : null) };
  });
  const writeMenu = untrack(() => createMenuWriter(props.app, setWindowFailure));

  createEffect(() => {
    nativeMenu();

    void writeMenu(nativeMenu);
  });
  onCleanup(untrack(() => props.app.onProjectPage(({ path, command }) => {
    if (path !== projects.active()) return;
    const open = connectionOf(path);

    if (!open) return;

    if (command.startsWith("view:")) {
      const view = command.slice(5);

      if (views.some(([id]) => id === view) && (view !== "resources" || open.rail.nodes.some(node => node.id === open.rail.selected() && (node.kind === "agent" || node.kind === "workstream" && node.attempt !== null)))) { if (open.hasView(view)) open.hideView(view); else open.showView(view); }
    } else captureActions(menuFocus()).find(action => action.value === command && action.available())?.run();
  })));

  // FS5979a: one sheet, and only with a Project open; a second request while it is open changes nothing.
  const [forkOpen, setForkOpen] = createSignal(false);
  const [forkAsked, setForkAsked] = createSignal(false);
  onCleanup(untrack(() => props.app.onForkSheet(() => { if (projects.tabs().length > 0) { setForkAsked(true); setForkOpen(true); } })));
  const forkSources = () => projects.tabs().map(tab => ({ path: tab.project.path, name: tab.project.name, nodes: railOf(tab.project.path)?.nodes ?? [] }));

  /** U181: that Project opens and its most urgent Agent is selected, as leader `J` does. */
  const jumpTo = (path: string) => {
    const rail = railOf(path);
    const next = rail && nextAttention(rail.nodes, rail.selected(), rail.dismissed);

    if (next) rail?.select(next.id);

    projects.select(path);
  };



  // U5232e: a click on a State alert opens that Agent in its Project, as a click on its Rail row does.
  onCleanup(untrack(() => props.app.onStateAlertClicked(agent => {
    const path = [...connections().keys()].find(each => railOf(each)?.nodes.some(node => node.id === agent));

    if (path === undefined) return;

    railOf(path)?.select(agent, "open");
    projects.select(path);
  })));

  onCleanup(shelfFocus.stop);
  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.shelf"], capture: () => {
    const wasOpen = frame.open();

    return {
      available: () => activeConnection() != null,
      invoke: () => { if (frame.open() === wasOpen) shelfFocus.toggle("key"); },
    };
  } }]);

  const [projectPicker, setProjectPicker] = createSignal(false);
  const [projectQuery, setProjectQuery] = createSignal("");
  const [projectHighlight, setProjectHighlight] = createSignal<string | null>(null);
  let projectPanel: HTMLElement | undefined;
  let projectOpener: Element | null = null;

  /** Esc or a dismissal returns focus to where it was before the picker opened; choosing a Project moves focus itself. */
  const dismissProjectPicker = () => {
    setProjectPicker(false);
    returnFocus(projectOpener);
  };

  const projectMatches = () => projects.tabs().filter(tab => tab.project.name.toLowerCase().includes(projectQuery().toLowerCase())).map(tab => ({ value: tab.project.path, label: tab.project.name }));

  createEffect(() => { if (!projectMatches().some(item => item.value === projectHighlight())) setProjectHighlight(projectMatches()[0]?.value ?? null); });
  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.project"], capture: () => ({ available: () => projects.tabs().length > 1, invoke: () => { projectOpener = document.activeElement; setProjectQuery(""); setProjectPicker(true); } }) }]);
  registerKeys({ kind: "layer", element: () => projectPanel, active: projectPicker, modal: true }, [{ chords: ["Escape"], run: dismissProjectPicker }]);

  const emulators = () => props.createEmulator ?? lazyXtermEmulators();

  return (
    <ReducedMotionContext.Provider value={props.reducedMotion}><DisplayClockContext.Provider value={now.subscribe}><ProjectDraftsContext.Provider value={drafts}><Show when={projects.loaded()}>
      <For each={keys()}>
        {(key) => <Connection drafts={drafts} app={dropTargets.app} tab={tabOf(key)} reducedMotion={props.reducedMotion} now={pollingNow} clock={props.clock} onConnected={connect} onRecovered={projects.connected} onRequested={answer} onOpen={opening.answer} toasts={toasts} alerts={alerts} projectAlerts={() => projectAlerts.level(key)} active={() => projects.active() === key} viewing={() => projects.active() === key && visible() && focus() === "focused" && !settingsOpen()} show={() => projects.select(key)} open={() => projects.tabs().map(tab => tab.project)} nodes={path => railOf(path)?.nodes ?? []} openIn={(path, workstream) => { railOf(path)?.select(workstream, "open"); projects.select(path); }} />}
      </For>
      <ProjectOpening opening={opening} />
      <DockBadge app={props.app} rails={() => [...connections()].flatMap(([path, connection]) => (connection instanceof Error ? [] : [{ alerts: projectAlerts.level(path), nodes: attentionHolders(connection.rail.nodes, connection.rail.terminals(), connection.rail.dismissed) }]))} onFailure={hide} />
      <Tabs.Root id={tabsId} value={projects.active()} onValueChange={({ value }) => projects.select(value)} activationMode="manual" style={{ display: "contents" }}
        ids={{
          trigger: (path) => `tabs:${tabsId}:trigger-${encodeURIComponent(path)}`,
          content: (path) => `tabs:${tabsId}:content-${encodeURIComponent(path)}`,
        }}
      >
      <Tabs.Context>{(tabs) => <Layout
        tabs={projects.active() === null ? {} : { ...tabs().getContentProps({ value: projects.active()! }), "aria-label": activeTab()?.project.name }}
        widths={widths}
        railOpen={projects.tabs().length > 0}
        busy={projects.tabs().length > 0 && activeConnection() === undefined}
        shelfPlacement={{ maximised: frame.maximised(), onMaximise: frame.toggleMaximise, open: frame.open(), peeking: frame.peeking(), covering: frame.covering(), rendered: frame.rendered(), shown: frame.shown(), animated: frame.animated(), reducedMotion: props.reducedMotion(), onClose: source => shelfFocus.toggle(source), onSettle: frame.settle, attach: frame.attach, sliding: frame.sliding() }}
        header={
          <WindowBar
            railToggle={railToggle()}
            app={props.app}
            onFailure={setWindowFailure}
            project={renamingProjects().get(projects.active() ?? "")?.name ?? activeTab()?.project.name}
            rail={railOf(projects.active() ?? "")}
          >
            <Show when={projects.tabs().length > 0}><Strip
              tabs={stripTabs()}
              active={projects.active()}
              onSelect={projects.select}
              onMark={jumpTo}
              onRename={renameProject}
              onClose={(path) => projects.close(path)}
              onReorder={projects.reorder}
              alerts={projectAlerts}
              onChoose={() => void projects.choose()}
              app={props.app}
            /></Show>
          </WindowBar>
        }
        railPeeking={railPeeking()}
        railSlide={railSlide.motion()}
        railStrip={<InProject open={activeConnection()}>{() => <RailStrip />}</InProject>}
        rail={
          <>
            <ReservedLine overlay message={railLine.message()} dismiss={railLine.dismiss} recover={projects.readFailure() && projects.tabs().length > 0 && !windowFailure() && !activeTab()?.exit ? { run: () => void projects.reload() } : undefined} action={<>
              <Show when={activeTab()?.exit && !activeTab()?.exit?.recovery}><Reopen onReopen={() => void projects.reopen(activeTab()!.project.path)} busy={projects.reopening()} /></Show>
            </>} />
            <Show when={projects.tabs().length > 0} fallback={<EmptyRail />}>
              <InProject open={activeConnection()}>
                {() => (
                  <>
                    <AttentionKey />
                    <Rail />
                  </>
                )}
              </InProject>
            </Show>
          </>
        }
        centre={
          <div class="storage-center">
          <For each={drafts.paths?.() ?? keys()}>{path => {
            const undo = drafts(path).todoUndo;

            const failure = () => projects.active() === path ? undo.feedbackFailure() : null;

            return <ReservedLine class="todo-undo" overlay message={failure()} dismiss={undo.dismiss} action={<Show when={undo.uncertain()}><button data-button="quiet" type="button" disabled={undo.pending()} onClick={() => void undo.retryDelete()}>{copy.todoDeleteRetry}</button></Show>} />;
          }}</For>
          <div class="centre-failures">
            <For each={keys()}>{path => {
              const failure = () => connectionOf(path)?.rail.commandFailure;
              const message = () => projects.active() !== path && failure()?.surface() === "rail" ? failure()?.message() : null;
              const name = () => tabOf(path)()?.project.name ?? "";
  
              return <Show when={message()}>{message => <ReservedLine class="centre-notice" message={`${name()}: ${message()}`} dismiss={() => failure()?.clear()} action={<button data-button="quiet" type="button" onClick={() => projects.select(path)}>{copy.openDraft} {name()}</button>} />}</Show>;
            }}</For>
            <Show when={nativeFailure()}>{failure => <ReservedLine class="centre-notice" message={failure().message} dismiss={() => setNativeFailure(null)} recover={failure().action ?? undefined} />}</Show>
            <Show when={storageFailures().length > 0}><div class="storage-failure"><ReservedLine message={storageLine.message()} dismiss={storageLine.dismiss} recover={{ run: () => void Promise.all(storageFailures().map(problem => problem.retry())), label: storageCopy.saveRetry }} /></div></Show>
          </div>
          <div class="centre-frame">
          <div class="settings-center">
          <div class="settings-center-content" inert={settingsOpen()} style={{ visibility: settingsOpen() ? "hidden" : "visible" }}>
          <Show when={projects.tabs().length > 0} fallback={<ChooseProject app={props.app} onOpen={path => void projects.open(path)} failure={projects.failure()} onChoose={() => void projects.choose()} onRetry={projects.readFailure() ? () => void projects.reload() : undefined} />}>
            <InProject open={activeConnection()} failed={failure => failureLine(failure, () => void projects.reopen(projects.active()!))} pending={<div role="img" aria-label={copy.loadingProject} class="light" style={{ padding: "var(--space-4)" }}><Hourglass class="icon" aria-hidden="true" /></div>}>
              {(open) => {
                const tracked = emulators();
                const [screens, setScreens] = createSignal<Screens>();
                const arrived = projects.arrival(open.project.path);

                // U6371a: the Pane's effects have run by the next microtask; a user's own focus move since the switch has voided the request.
                if (arrived) queueMicrotask(() => arrived(() => {
                  const id = open.rail.nodes.find(node => node.id === open.rail.selected())?.terminal_id;

                  if (id) screens()?.emulatorFor(id).focus();
                  else focusPane();
                }));

                return (
                  <div class="centre-stack">
                    <div class="project-center-area">
                    <div class="project-center-content" inert={open.settingsView.open()} style={{ visibility: open.settingsView.open() ? "hidden" : "visible" }}>
                    <Pane observeTerminal={props.observeTerminal ? id => props.observeTerminal?.(open.project.path, id) : undefined} notice={open.rail.failure() ?? jumpFailure() ?? open.contractNotice} retryNotice={open.rail.failure() !== null ? () => void open.rail.refresh({ terminals: true }) : undefined} createEmulator={tracked} screensRef={setScreens} openObject={(url, surface) => routeNativeOpen({ kind: "link", url, surface })} />
                    <AskBar viewLabel={id => views.find(([view]) => view === id)?.[1]} />
                    <Feedback notify={toasts.notify} />
                    <Switcher notify={toasts.notify} onFailure={setJumpFailure} onOpen={() => { if (document.querySelector('.window[data-shelf="open"][data-shelf-mode="overlay"]')) shelfFocus.toggle("key"); }} />
                    </div>
                    <ProjectSettingsView />
                    </div>
                    <Show when={screens()}>{(shared) => <Bubbles screens={shared()} />}</Show>
                    <ResourceStrip returnFocus={() => { const id = open.rail.nodes.find(node => node.id === open.rail.selected())?.terminal_id;

                      if (id) screens()?.emulatorFor(id).focus();
                      else captureActions(document.activeElement).find(action => action.value === "action:chord:⌘/")?.run(); }} />
                  </div>
                );
              }}
            </InProject>
          </Show>
          </div>
          <Show when={forkAsked()}><ForkSheet app={props.app} open={forkOpen()} sources={forkSources} onClose={() => setForkOpen(false)} /></Show>
          <AppSettings app={props.app} project={() => projects.active()} view={settingsView} navigation={() => {
            const open = activeConnection();

            return `${projects.active()}\n${open instanceof Error ? "" : open?.rail.selected()}`;
          }} />
          </div>
          </div>
          </div>
        }
        shelfTabs={<Tabs.RootProvider value={shelfTabs} style={{ display: "contents" }} onKeyDown={shelfFocus.moveFocus}>
          <Show when={frame.rendered()}><InProject open={activeConnection()} failed={() => <ShelfTabs frame={frame} onToggle={shelfFocus.toggle} />}>
            {() => <ProjectShelfTabs frame={frame} onToggle={shelfFocus.toggle} />}
          </InProject></Show>
        </Tabs.RootProvider>}
        shelf={
          <Tabs.RootProvider value={shelfTabs} id="shelf-panels" lazyMount unmountOnExit style={{ display: "contents" }} onKeyDown={shelfFocus.moveFocus}>
            <Show when={projects.tabs().length > 0} fallback={<Show when={frame.rendered()}><Tabs.Content value={frame.tab()} class="shelf-panel"><EmptyShelf /></Tabs.Content></Show>}>
              <InProject open={activeConnection()} failed={() => <Tabs.Content value={frame.tab()} class="shelf-panel" />}>
                {() => <Show when={frame.rendered()}><Shelf open={frame.open} /></Show>}
              </InProject>
            </Show>
          </Tabs.RootProvider>
        }
        overlay={
          <>
            <InProject open={activeConnection()}>
              {(open) => (
                <>
                  <DrawerHost drawer={open.drawer} reducedMotion={open.reducedMotion} />
                  <Leader />
                  <InboxKey />
                  
                </>
              )}
            </InProject>
            <Show when={projectPicker()}><section class="switcher" ref={projectPanel}>
              <Combobox.Root items={projectMatches()} inputValue={projectQuery()} onInput={setProjectQuery} highlightedValue={projectHighlight()} onHighlightChange={setProjectHighlight} label={copy.switchProject} placeholder={copy.switcherPlaceholder} empty={copy.noMatch} row={item => item.label} focusScope={() => projectPanel} onDismiss={dismissProjectPicker} onSelect={path => { setProjectPicker(false); projects.select(path); }} />
            </section></Show>
            <InProject open={captureOwner()}>{(open) => <Capture onReady={show => setCaptureShow(() => show)} onNativeOpen={shown => setCaptureConnection(shown ? open : undefined)} onFile={() => { if (!frame.open()) shelfFocus.toggle("key"); frame.setTab("todos"); }} />}</InProject>
            <Help projectOpen={activeConnection() != null} shelfOpen={frame.open()} />
            <Toasts queue={toasts} />
          </>
        }
      />}</Tabs.Context>
      </Tabs.Root>
    </Show></ProjectDraftsContext.Provider></DisplayClockContext.Provider></ReducedMotionContext.Provider>
  );
};
