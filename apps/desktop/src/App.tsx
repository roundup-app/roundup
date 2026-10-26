import { PadDrawer } from "./pads/PadDrawer";
import { TodoDrawer } from "./todos/TodoDrawer";
import { usePadList } from "./rail/pads/padList";
import { useTodoList } from "./todos/todoList";
import type { LinkContent } from "@contracts/link/LinkContent";
import Hourglass from "lucide-solid/icons/hourglass";
import { ReducedMotionContext } from "./app/reducedMotion";
import { debounce } from "@solid-primitives/scheduled";
import { pressFeedback } from "./ui/pressFeedback";
import { storageCopy } from "./copy/storage";
import { writeText } from "./app/clipboard";
import { storageProblems, retainedStorage } from "./state/storage";
import "./state/storage.css";
import { textTarget } from "./ui/contextMenu";
import { AppSettings } from "./settings/AppSettings";
import { appSettings, applySystemAccent, applyAppAppearance } from "./settings/preferences";
import { registerKeys } from "./keys/registry";
import { LEADER } from "./keys/chords";
import { copy } from "./copy";
import "./buttons.css";
import { createEffect, createMemo, createResource, createSignal, createUniqueId, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { ChooseProject, EmptyRail, EmptyShelf } from "./app/FirstRun";
import { Layout } from "./app/Layout";
import { Tabs } from "./ui/Tabs";
import { Reopen } from "./app/Reopen";
import { createDropTargets } from "./app/dropTargets";
import type { Requested } from "@contracts/project/Requested";
import type { App as AppCalls, DaemonExit } from "./app/seam";
import { DrawerHost } from "./drawer/DrawerHost";
import { InboxKey } from "./inbox/Inbox";
import { WindowBar } from "./header/WindowBar";
import { Strip } from "./header/Strip";
import type { StripTab } from "./header/tab";
import { ReservedLine } from "./ink/ReservedLine";
import { failureLine } from "./ink/ReservedLine";
import { exitText } from "./ink/exitText";
import { AttentionKey } from "./rail/AttentionKey";
import { attentionCounts, nextAttention } from "./rail/attention";
import { DockBadge } from "./rail/DockBadge";
import { railStorage } from "./rail/persist/storage";
import { Rail } from "./rail/Rail";
import { ProjectSettingsView } from "./rail/ProjectSettings";
import { Help } from "./keys/Help";
import { Leader } from "./keys/Leader";
import { Capture } from "./todos/Capture";
import { Keys } from "./keys/Keys";
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
import { REVEAL_BUBBLE } from "./bubbles/places";
import { AskBar } from "./ask/AskBar";
import { Switcher } from "./switcher/Switcher";
import { Pane } from "./terminal/Pane";
import type { Screens } from "./terminal/screens";
import { ResourceStrip } from "./resources/ResourceStrip";
import { createShelfFrame } from "./shelf/frame";
import { Shelf, createShelfTabs, ShelfTabs, ProjectShelfTabs } from "./shelf/Shelf";
import { shelfKeys } from "./shelf/keys";
import { createWidths } from "./resize/widths";

const daemonExitText = ({ code, recovery, cause }: DaemonExit): string | null =>
  recovery ? null : cause ?? copy.daemonExit(exitText(code === null ? { kind: "signal" } : { kind: "code", code }));

const LinkedItem = (props: { content: LinkContent; onLateFailure: (message: string) => void }) => {
  const pads = usePadList();
  const todos = useTodoList();
  const content = props.content;

  if (content.kind === "pad") return <PadDrawer name={content.id} heading={content.section?.heading} pads={pads.pads} onLateFailure={props.onLateFailure} />;

  if (content.kind === "todo") return <TodoDrawer id={content.todo.id} todos={todos} />;

  return null;
};

const RUNNING = new Set(["working", "needs-you", "blocked"]);

type Connections = ReadonlyMap<string, ConnectedProject | Error>;

/** One Project's live connection to its Daemon, kept while its tab is open and its regions are not on screen, so its Tab mark stays current (U181). */
const Connection = (props: {
  app: AppCalls;
  tab: () => OpenTab | undefined;
  reducedMotion: Accessor<boolean>;
  now: Accessor<number>;
  drafts: ReturnType<typeof createProjectDrafts>;
  onConnected: (path: string, connection: ConnectedProject | Error | null) => void;
  onRecovered: (path: string, generation: number) => void;
  onRequested: (request: Requested) => void;
  toasts: ToastQueue;
  active: () => boolean;
  /** U3566: this Project is on screen in a visible, focused window. */
  viewing: () => boolean;
  show: () => void;
}) => {
  const first = props.tab();

  if (!first) return null;

  const { path } = first.project;
  let mine: ConnectedProject | Error | undefined;

  const [connected] = createResource(() => props.tab()?.generation, async (generation) => {
    try {
      const next = await connectProject(props.app.forProject(path), first.project, props.reducedMotion, props.now, () => props.tab()?.generation === generation ? props.tab()?.exit ?? null : { code: null, recovery: "connecting" }, railStorage(path), props.drafts(path), props.viewing);

      if (props.tab()?.generation !== generation) {
        next.stopTerminalScheme();

        return mine;
      }

      props.onRecovered(path, generation);

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

  // M8: the Daemon cannot reach the App, so an Agent's open or rename of a Project arrives as an Event.
  createEffect(() => {
    const open = connected();

    if (!open || open instanceof Error) return;

    const stop = open.events.subscribe((event) => {
      if (event.name === "project.requested") props.onRequested(event.data);
    });

    onCleanup(stop);
  });

  // U410: the Events of this Project that make a Toast.
  createEffect(() => {
    const open = connected();

    if (!open || open instanceof Error) return;

    // Untracked: watchProject reads the Rail's nodes, and each Status change would else rebuild the watch with that change already seen.
    onCleanup(untrack(() => watchProject(open, props.toasts.push, props.show, props.active, props.toasts.settle)));
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

export const App = (props: {
  app: AppCalls;
  reducedMotion: Accessor<boolean>;
  clock: Clock;
  createEmulator?: EmulatorFactory | undefined;
  prepareIdle?: ((project: ConnectedProject) => void) | undefined;
  observeTerminal?: ((project: string | null, id: string | null) => void) | undefined;
  /** U410: the Toast sound; the webview's own by default. */
  chime?: Chime | undefined;
  /** App-run draft authority; embedding callers may supply the same holder to surface owners. */
  drafts?: ReturnType<typeof createProjectDrafts>;
}) => {
  const clearBrowserSelection = (event: MouseEvent) => {

    if (event.button !== 0 || event.ctrlKey) return;

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

  onMount(() => {
    onCleanup(pressFeedback(document, props.reducedMotion));
    window.addEventListener("contextmenu", suppressBrowserMenu);
    window.addEventListener("pointerdown", clearBrowserSelection, true);
  });
  onCleanup(() => {
    window.removeEventListener("contextmenu", suppressBrowserMenu);
    window.removeEventListener("pointerdown", clearBrowserSelection, true);
  });

  applyAppAppearance();
  applySystemAccent(props.app);
  const projects = createProjectsState(props.app);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const drafts = props.drafts ?? createProjectDrafts();
  const tabsId = createUniqueId();
  const [connections, setConnections] = createSignal<Connections>(new Map());
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");
  const onVisibility = () => setVisible(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));
  // U3566: the window's focus, which `document.hasFocus()` alone does not announce.
  const [focused, setFocused] = createSignal(document.hasFocus());
  const onFocus = () => setFocused(true);
  const onBlur = () => setFocused(false);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  onCleanup(() => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  });

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
  const [badgeFailure, setBadgeFailure] = createSignal<string | null>(null);
  const capture = props.app.capture;
  onMount(() => {
    void capture?.configure(appSettings().quickAdd).catch(error => setWindowFailure(String(error)));
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

  const answer = (request: Requested) => void (request.kind === "open" ? projects.open(request.path) : renameProject(request.path, request.name));

  const tabOf = (path: string) => () => projects.tabs().find((tab) => tab.project.path === path);

  const railOf = (path: string): ConnectedProject["rail"] | undefined => {
    const connection = connections().get(path);

    return connection instanceof Error ? undefined : connection?.rail;
  };

  const connectionOf = (path: string): ConnectedProject | undefined => {
    const connection = connections().get(path);

    return connection instanceof Error ? undefined : connection;
  };

  const [linked, setLinked] = createSignal<{ path: string; content: LinkContent } | null>(null);
  createEffect(() => {
    const target = linked();
    const open = target && connectionOf(target.path);

    if (!target || !open) return;
    const content = target.content;
    projects.select(target.path);
    open.settingsView.close();

    if (content.kind === "agent" || content.kind === "workstream") open.rail.select(content.id);
    else if (content.kind === "terminal") {
      const owner = open.rail.nodes.find(node => node.terminal_id === content.id)?.id
        ?? open.rail.terminals().find(terminal => terminal.id === content.id)?.owner;

      open.rail.select(owner === target.path ? null : owner ?? null);
      // The active Project mounts its existing Bubble listener after selection.
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(REVEAL_BUBBLE, { detail: content.id })));
    } else if (content.kind === "pad" || content.kind === "todo") {
      open.drawer.open(() => <LinkedItem content={content} onLateFailure={setWindowFailure} />, "key");
    }

    setLinked(null);
  });

  onMount(() => {
    let stopped = false;
    let release: (() => void) | undefined;
    let pending = Promise.resolve();
    void props.app.onNativeOpen?.(request => {
      pending = pending.then(async () => {
        if (stopped) return;

        if (request.kind === "project") {
          await projects.open(request.path);

          return;
        }
        // Only link.read parses and authorizes the URL. A foreign Project cannot resolve
        // a same-named object; unopened Projects are never discovered from filesystem names.

        const listed = await props.app.projects();
        const failures: string[] = [];

        for (const project of listed.filter(project => project.running)) {
          try {
            const content = await props.app.forProject(project.path).rpc("link.read", { url: request.url });

            if (content.kind === "deliverable") throw new Error("This published link cannot be opened here. Open it from Results.");
            setLinked({ path: project.path, content });
            setWindowFailure(null);

            return;
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            failures.push(error.message);
          }
        }

        setWindowFailure(failures.join("; ") || "The link's Project is not open. Open that Project and try the link again.");
      }).catch(error => { if (!(error instanceof Error)) throw error; setWindowFailure(error.message); });
    }).then(stop => { if (stopped) stop(); else release = stop; }).catch(error => setWindowFailure(String(error)));
    onCleanup(() => { stopped = true; release?.(); });
  });

  const stripTabs = createMemo<StripTab[]>(() =>
    projects.tabs().map((tab) => {
      const nodes = railOf(tab.project.path)?.nodes ?? [];

      return {
        path: tab.project.path,
        name: tab.project.name,
        base: projects.base(tab.project.path),
        exitText: tab.exit ? daemonExitText(tab.exit) : null,
        busy: !connections().has(tab.project.path),
        ...attentionCounts(nodes),
        unseen: connectionOf(tab.project.path)?.unseen.any() ?? false,
        running: nodes.flatMap((node) => (node.status && RUNNING.has(node.status.kind) ? [node.name] : [])),
      };
    }),
  );

  // U348: a drag of files over the window; the Projects' regions hear the drops it lets through.
  const dropTargets = createDropTargets(props.app, { rail: () => railOf(projects.active() ?? ""), select: projects.select });
  let stopDrag: (() => void) | undefined;
  let torn = false;

  void dropTargets.start().then((stop) => {
    if (torn) stop();
    else stopDrag = stop;
  });
  onCleanup(() => {
    torn = true;
    stopDrag?.();
  });

  const activeTab = createMemo(() => projects.tabs().find((tab) => tab.project.path === projects.active()));

  const activeConnection = createMemo(() => {
    const path = projects.active();

    return path === null ? undefined : connections().get(path);
  });

  const [captureConnection, setCaptureConnection] = createSignal<ConnectedProject>();
  const captureOwner = () => captureConnection() ?? activeConnection();

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

  createEffect(() => { void props.app.selectProjectMenu(projects.active()).catch(error => setWindowFailure(error instanceof Error ? error.message : String(error))); });

  /** U181: that Project opens and its most urgent Agent is selected, as leader `J` does. */
  const jumpTo = (path: string) => {
    projects.select(path);

    const rail = railOf(path);
    const next = rail && nextAttention(rail.nodes, rail.selected());

    if (next) rail?.select(next.id);
  };

  // U370, U373: the Shelf's open state and open tab, kept per Project.
  const shelfElement = () => document.querySelector<HTMLElement>(".shelf");
  const frame = createShelfFrame(projects.active, props.reducedMotion, () => void shelfElement()?.offsetWidth);
  const widths = createWidths(projects.active);
  const shelfTabs = createShelfTabs(frame);
  const shelfFocus = shelfKeys({ frame, shelf: shelfElement });

  onCleanup(shelfFocus.stop);
  registerKeys({ kind: "leader" }, [{ action: LEADER.find((row) => row.keys === "S")!, capture: () => {
    const wasOpen = frame.open();

    return {
      available: () => shelfElement() != null,
      invoke: () => { if (frame.open() === wasOpen) shelfFocus.toggle("key"); },
    };
  } }]);

  const emulators = () => props.createEmulator ?? lazyXtermEmulators();

  return (
    <ReducedMotionContext.Provider value={props.reducedMotion}><DisplayClockContext.Provider value={now.subscribe}><ProjectDraftsContext.Provider value={drafts}><Show when={projects.loaded()}>
      <For each={keys()}>
        {(key) => <Connection drafts={drafts} app={dropTargets.app} tab={tabOf(key)} reducedMotion={props.reducedMotion} now={pollingNow} onConnected={connect} onRecovered={projects.connected} onRequested={answer} toasts={toasts} active={() => projects.active() === key} viewing={() => projects.active() === key && visible() && focused()} show={() => projects.select(key)} />}
      </For>
      <DockBadge app={props.app} rails={() => [...connections().values()].flatMap((connection) => (connection instanceof Error ? [] : [connection.rail.nodes]))} onFailure={setBadgeFailure} />
      <Tabs.Root id={tabsId} value={projects.active()} onValueChange={({ value }) => projects.select(value)} activationMode="manual" style={{ display: "contents" }}
        ids={{
          trigger: (path) => `tabs:${tabsId}:trigger-${encodeURIComponent(path)}`,
          content: (path) => `tabs:${tabsId}:content-${encodeURIComponent(path)}`,
        }}
      >
      <Tabs.Context>{(tabs) => <Layout
        tabs={projects.active() === null ? {} : { ...tabs().getContentProps({ value: projects.active()! }), "aria-label": activeTab()?.project.name }}
        widths={widths}
        busy={projects.tabs().length > 0 && activeConnection() === undefined}
        shelfPlacement={{ maximised: frame.maximised(), onMaximise: frame.toggleMaximise, open: frame.open(), rendered: frame.rendered(), shown: frame.shown(), animated: frame.animated(), reducedMotion: props.reducedMotion(), onClose: source => shelfFocus.toggle(source), onSettle: frame.settle, attach: frame.attach, sliding: frame.sliding() }}
        header={
          <WindowBar
            app={props.app}
            shelf={
              <Tabs.RootProvider value={shelfTabs} style={{ display: "contents" }} onKeyDown={shelfFocus.moveFocus}>
                <Show when={projects.tabs().length > 0} fallback={<ShelfTabs frame={frame} onToggle={shelfFocus.toggle} />}>
                  <InProject open={activeConnection()} failed={() => <ShelfTabs frame={frame} onToggle={shelfFocus.toggle} />}>
                    {() => <ProjectShelfTabs frame={frame} onToggle={shelfFocus.toggle} />}
                  </InProject>
                </Show>
              </Tabs.RootProvider>
            }
            onFailure={setWindowFailure}
            project={renamingProjects().get(projects.active() ?? "")?.name ?? activeTab()?.project.name}
            rail={railOf(projects.active() ?? "")}
          >
            <Strip
              tabs={stripTabs()}
              active={projects.active()}
              onSelect={projects.select}
              onMark={jumpTo}
              onRename={renameProject}
              onClose={(path) => projects.close(path)}
              onChoose={() => void projects.choose()}
              app={props.app}
            />
          </WindowBar>
        }
        rail={
          <>
            <ReservedLine overlay message={windowFailure() ?? (activeTab()?.exit ? activeTab()?.reopenFailure ?? daemonExitText(activeTab()!.exit!) : null) ?? (projects.tabs().length > 0 ? projects.failure() ?? badgeFailure() : badgeFailure())}>
              <Show when={projects.readFailure() && projects.tabs().length > 0 && !windowFailure() && !activeTab()?.exit}><button data-button="quiet" type="button" onClick={() => void projects.reload()}>{copy.retry}</button></Show>
              <Show when={activeTab()?.exit && !activeTab()?.exit?.recovery}><Reopen onReopen={() => void projects.reopen(activeTab()!.project.path)} busy={projects.reopening()} /></Show>
            </ReservedLine>
            <Show when={projects.tabs().length > 0} fallback={<EmptyRail />}>
              <InProject open={activeConnection()}>
                {() => (
                  <>
                    <Keys />
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
          <Show when={storageFailures().length > 0}><div class="storage-failure"><ReservedLine message={storageCopy.failure(storageFailures())}>
            <button data-button="quiet" type="button" onClick={() => void Promise.all(storageFailures().map(problem => problem.retry()))}>{storageCopy.saveRetry}</button>
          </ReservedLine></div></Show>
          <Show when={retainedStorage().length > 0}><div class="storage-retained" role="group" aria-label={storageCopy.retained(retainedStorage().length)}>
            <span>{storageCopy.retained(retainedStorage().length)}</span>
            <For each={retainedStorage()}>{record => {
              const [copied, setCopied] = createSignal(false);
              const clearCopied = debounce(() => setCopied(false), 2000);

              return <button data-button="quiet" type="button" onClick={() => void writeText(props.app, JSON.stringify(record)).then(() => { setCopied(true); clearCopied(); }).catch(error => { setCopied(false); setWindowFailure(error instanceof Error ? error.message : String(error)); })}>
                <span class="storage-copy-label" style={{ visibility: copied() ? "hidden" : "visible" }} aria-hidden={copied()}>{storageCopy.recoveryLabel(record.key)}</span>
                <span class="storage-copy-label" style={{ visibility: copied() ? "visible" : "hidden" }} aria-hidden={!copied()}>{storageCopy.recoveryLabel(record.key, true)}</span>
              </button>;
            }}</For>
          </div></Show>
          <div class="settings-center">
          <div class="settings-center-content" inert={settingsOpen()} style={{ visibility: settingsOpen() ? "hidden" : "visible" }}>
          <Show when={projects.tabs().length > 0} fallback={<ChooseProject failure={projects.failure()} onChoose={() => void projects.choose()} onRetry={projects.readFailure() ? () => void projects.reload() : undefined} />}>
            <InProject open={activeConnection()} failed={failureLine} pending={<div role="img" aria-label={copy.loadingProject} class="light" style={{ padding: "var(--space-4)" }}><Hourglass class="icon" aria-hidden="true" /></div>}>
              {(open) => {
                const tracked = emulators();
                const [screens, setScreens] = createSignal<Screens>();

                return (
                  <div class="centre-stack">
                    <div class="project-center-area">
                    <div class="project-center-content" inert={open.settingsView.open()} style={{ visibility: open.settingsView.open() ? "hidden" : "visible" }}>
                    <Pane observeTerminal={props.observeTerminal ? id => props.observeTerminal?.(open.project.path, id) : undefined} notice={open.rail.failure() ?? jumpFailure() ?? open.contractNotice} retryNotice={open.rail.failure() !== null ? () => void open.rail.refresh({ terminals: true }) : undefined} createEmulator={tracked} screensRef={setScreens} />
                    <AskBar />
                    <Switcher onFailure={setJumpFailure} onOpen={() => { if (document.querySelector('.window[data-shelf="open"][data-shelf-mode="overlay"]')) shelfFocus.toggle("key"); }} />
                    </div>
                    <ProjectSettingsView />
                    </div>
                    <Show when={screens()}>{(shared) => <Bubbles screens={shared()} />}</Show>
                    <ResourceStrip />
                  </div>
                );
              }}
            </InProject>
          </Show>
          </div>
          <AppSettings app={props.app} project={() => projects.active()} onOpenChange={setSettingsOpen} />
          </div>
          </div>
        }
        shelf={
          <Tabs.RootProvider value={shelfTabs} id="shelf-panels" lazyMount unmountOnExit style={{ display: "contents" }} onKeyDown={shelfFocus.moveFocus}>
            <Show when={projects.tabs().length > 0} fallback={<Tabs.Content value={frame.tab()} class="shelf-panel"><EmptyShelf /></Tabs.Content>}>
              <InProject open={activeConnection()} failed={() => <Tabs.Content value={frame.tab()} class="shelf-panel" />}>
                {() => <Shelf open={frame.open} />}
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
                  <Help />
                  <Leader />
                  <InboxKey />
                  
                </>
              )}
            </InProject>
            <InProject open={captureOwner()}>{(open) => <Capture onNativeOpen={shown => setCaptureConnection(shown ? open : undefined)} onFile={() => { if (!frame.open()) shelfFocus.toggle("key"); frame.setTab("todos"); }} />}</InProject>
            <Toasts queue={toasts} />
          </>
        }
      />}</Tabs.Context>
      </Tabs.Root>
    </Show></ProjectDraftsContext.Provider></DisplayClockContext.Provider></ReducedMotionContext.Provider>
  );
};
