import { AppSettings } from "./settings/AppSettings";
import { applyAppAppearance } from "./settings/preferences";
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
import { createXtermEmulators } from "./terminal/emulator";
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
import { Pane } from "./terminal/Pane";
import type { Screens } from "./terminal/screens";
import { ResourceStrip } from "./resources/ResourceStrip";
import { createShelfFrame } from "./shelf/frame";
import { Shelf, createShelfTabs, ShelfTabs, ProjectShelfTabs } from "./shelf/Shelf";
import { shelfKeys } from "./shelf/keys";
import { createWidths } from "./resize/widths";

const daemonExitText = ({ code }: DaemonExit): string =>
  copy.daemonExit(exitText(code === null ? { kind: "signal" } : { kind: "code", code }));

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
  onRequested: (request: Requested) => void;
  toasts: ToastQueue;
  active: () => boolean;
  show: () => void;
}) => {
  const first = props.tab();

  if (!first) return null;

  const { path } = first.project;
  let mine: ConnectedProject | Error | undefined;

  const [connected] = createResource(async () => {
    try {
      return await connectProject(props.app.forProject(path), first.project, props.reducedMotion, props.now, () => props.tab()?.exit ?? null, railStorage(path), props.drafts(path));
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;

      return failure;
    }
  });

  createEffect(() => {
    mine = connected();

    if (mine) props.onConnected(path, mine);
  });

  createEffect(() => {
    const open = connected();

    if (open && !(open instanceof Error)) open.worktrees.watch(props.active);
  });

  // Refused Agent answers have no Event, so live requests refresh on the App's shared clock.
  createEffect(on(props.now, () => {
    const open = connected();

    if (open && !(open instanceof Error) && !props.tab()?.exit && open.decisions.open().length > 0) open.decisions.retryList();
  }, { defer: true }));

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
    onCleanup(untrack(() => watchProject(open, props.toasts.push, props.show, props.active)));
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

/** The regions of the open Project, inside its connection; nothing while it connects, and `failed` when connecting failed. */
const InProject = (props: { open: ConnectedProject | Error | undefined; failed?: (failure: Error) => JSX.Element; children: (open: ConnectedProject) => JSX.Element }) => (
  <Show when={props.open} keyed>
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

  const suppressBrowserMenu = (event: MouseEvent) => event.preventDefault();

  onMount(() => {
    window.addEventListener("contextmenu", suppressBrowserMenu, true);
    window.addEventListener("pointerdown", clearBrowserSelection, true);
  });
  onCleanup(() => {
    window.removeEventListener("contextmenu", suppressBrowserMenu, true);
    window.removeEventListener("pointerdown", clearBrowserSelection, true);
  });

  applyAppAppearance();
  const projects = createProjectsState(props.app);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const drafts = props.drafts ?? createProjectDrafts();
  const tabsId = createUniqueId();
  const [connections, setConnections] = createSignal<Connections>(new Map());
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");
  const onVisibility = () => setVisible(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));

  const isWorking = () => projects.tabs().some((tab) => {
    const connection = connections().get(tab.project.path);

    return !tab.exit && connection && !(connection instanceof Error)
      && connection.rail.nodes.some((node) => node.status?.kind === "working");
  });

  const now = createNow(props.clock, isWorking, visible);
  // Display demand must not enable the Worktree and Decision RPC cadence.
  const pollingNow = createMemo<number>((previous) => visible() && isWorking() ? now() : previous ?? untrack(now));
  // U413: roundup is in front while its window has focus and is visible.
  const inFront = () => document.hasFocus() && document.visibilityState === "visible";
  const toasts = createToastQueue(inFront, props.chime ?? webChime());
  const [jumpFailure, setJumpFailure] = createSignal<string | null>(null);
  const [windowFailure, setWindowFailure] = createSignal<string | null>(null);
  const [badgeFailure, setBadgeFailure] = createSignal<string | null>(null);

  createEffect(on(projects.active, () => setJumpFailure(null), { defer: true }));

  const connect = (path: string, connection: ConnectedProject | Error | null) =>
    setConnections((all) => {
      const next = new Map(all);

      if (connection) next.set(path, connection);
      else next.delete(path);

      return next;
    });

  // A reopen replaces the Daemon, so its connection is made whole again under a new key.
  const keys = createMemo(() => projects.tabs().map((tab) => `${tab.project.path}\n${tab.generation}`));

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

  const emulators = () => props.createEmulator ?? createXtermEmulators();

  return (
    <DisplayClockContext.Provider value={now.subscribe}><ProjectDraftsContext.Provider value={drafts}><Show when={projects.loaded()}>
      <For each={keys()}>
        {(key) => <Connection drafts={drafts} app={dropTargets.app} tab={tabOf(key.split("\n")[0]!)} reducedMotion={props.reducedMotion} now={pollingNow} onConnected={connect} onRequested={answer} toasts={toasts} active={() => projects.active() === key.split("\n")[0]} show={() => projects.select(key.split("\n")[0]!)} />}
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
        shelfPlacement={{ maximised: frame.maximised(), onMaximise: frame.toggleMaximise, open: frame.open(), rendered: frame.rendered(), shown: frame.shown(), animated: frame.animated(), reducedMotion: props.reducedMotion(), onClose: source => shelfFocus.toggle(source), onSettle: frame.settle }}
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
              <Show when={activeTab()?.exit}><Reopen onReopen={() => void projects.reopen(activeTab()!.project.path)} busy={projects.reopening()} /></Show>
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
          <div class="settings-center">
          <div class="settings-center-content" inert={settingsOpen()} style={{ visibility: settingsOpen() ? "hidden" : "visible" }}>
          <Show when={projects.tabs().length > 0} fallback={<ChooseProject failure={projects.failure()} onChoose={() => void projects.choose()} />}>
            <InProject open={activeConnection()} failed={failureLine}>
              {(open) => {
                const tracked = emulators();
                const [screens, setScreens] = createSignal<Screens>();

                return (
                  <div class="centre-stack">
                    <Pane notice={open.rail.failure() ?? jumpFailure() ?? open.contractNotice} createEmulator={tracked} screensRef={setScreens} toasts={toasts} />
                    <AskBar />
                    <Show when={screens()}>{(shared) => <Bubbles screens={shared()} />}</Show>
                    <Switcher onFailure={setJumpFailure} onOpen={() => { if (document.querySelector('.window[data-shelf="open"][data-shelf-mode="overlay"]')) shelfFocus.toggle("key"); }} />
                    <ResourceStrip />
                    <ProjectSettingsView />
                  </div>
                );
              }}
            </InProject>
          </Show>
          </div>
          <AppSettings app={props.app} project={() => projects.active()} onOpenChange={setSettingsOpen} />
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
                  <Capture onFile={() => { if (!frame.open()) shelfFocus.toggle("key"); frame.setTab("todos"); }} />
                </>
              )}
            </InProject>
            <Toasts queue={toasts} />
          </>
        }
      />}</Tabs.Context>
      </Tabs.Root>
    </Show></ProjectDraftsContext.Provider></DisplayClockContext.Provider>
  );
};
