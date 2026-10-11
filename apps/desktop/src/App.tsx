import "./buttons.css";
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { ChooseProject, EmptyRail, EmptyShelf } from "./app/FirstRun";
import { Layout } from "./app/Layout";
import { Reopen } from "./app/Reopen";
import { createDropTargets } from "./app/dropTargets";
import type { Requested } from "@contracts/project/Requested";
import type { App as AppCalls, DaemonExit } from "./app/seam";
import { DrawerHost } from "./drawer/DrawerHost";
import { Strip } from "./header/Strip";
import type { StripTab } from "./header/tab";
import { ErrorLine, failureLine } from "./ink/ErrorLine";
import { exitText } from "./ink/exitText";
import { Pads } from "./pads/Pads";
import { AttentionKey } from "./rail/AttentionKey";
import { attentionCounts, nextAttention } from "./rail/attention";
import { DockBadge } from "./rail/DockBadge";
import { railStorage } from "./rail/persist/storage";
import { Jump } from "./rail/Jump";
import { Rail } from "./rail/Rail";
import { Help } from "./keys/Help";
import { Keys } from "./keys/Keys";
import { createNow } from "./state/clock";
import type { Clock } from "./state/clock";
import { createProjectsState } from "./state/projects";
import type { OpenTab } from "./state/projects";
import { connectProject, ConnectedProjectContext } from "./state/connectedProject";
import type { ConnectedProject } from "./state/connectedProject";
import { createXtermEmulators } from "./terminal/emulator";
import type { EmulatorFactory } from "./terminal/emulator";
import { Pane } from "./terminal/Pane";
import { Thread } from "./thread/Thread";
import { trackSelections } from "./thread/emulators";
import { Todos } from "./todos/Todos";

const daemonExitText = ({ code }: DaemonExit): string =>
  `daemon ${exitText(code === null ? { kind: "signal" } : { kind: "code", code })}`;

const RUNNING = new Set(["working", "needs-you", "blocked"]);

type Connections = ReadonlyMap<string, ConnectedProject | Error>;

/** One Project's live connection to its Daemon, kept while its tab is open and its regions are not on screen, so its Tab mark stays current (U181). */
const Connection = (props: {
  app: AppCalls;
  tab: () => OpenTab | undefined;
  reducedMotion: Accessor<boolean>;
  now: Accessor<number>;
  onConnected: (path: string, connection: ConnectedProject | Error | null) => void;
  onRequested: (request: Requested) => void;
}) => {
  const first = props.tab();

  if (!first) return null;

  const { path } = first.project;
  let mine: ConnectedProject | Error | undefined;

  const [connected] = createResource(async () => {
    try {
      return await connectProject(props.app.forProject(path), first.project, props.reducedMotion, props.now, () => props.tab()?.exit ?? null, railStorage(path));
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;

      return failure;
    }
  });

  createEffect(() => {
    mine = connected();

    if (mine) props.onConnected(path, mine);
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
}) => {
  const projects = createProjectsState(props.app);
  const now = createNow(props.clock);
  const [connections, setConnections] = createSignal<Connections>(new Map());
  const [jumpFailure, setJumpFailure] = createSignal<string | null>(null);
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

  const answer = (request: Requested) => void (request.kind === "open" ? projects.open(request.path) : projects.rename(request.path, request.name));

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
        exitText: tab.exit ? daemonExitText(tab.exit) : null,
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

  /** U181: that Project opens and its most urgent Agent is selected, as `⌘J` does. */
  const jumpTo = (path: string) => {
    projects.select(path);

    const rail = railOf(path);
    const next = rail && nextAttention(rail.nodes, rail.selected());

    if (next) rail?.select(next.id);
  };

  const emulators = () => trackSelections(props.createEmulator ?? createXtermEmulators());

  return (
    <Show when={projects.loaded()}>
      <For each={keys()}>
        {(key) => <Connection app={dropTargets.app} tab={tabOf(key.split("\n")[0]!)} reducedMotion={props.reducedMotion} now={now} onConnected={connect} onRequested={answer} />}
      </For>
      <DockBadge app={props.app} rails={() => [...connections().values()].flatMap((connection) => (connection instanceof Error ? [] : [connection.rail.nodes]))} onFailure={setBadgeFailure} />
      <Layout
        header={
          <>
            <Strip
              tabs={stripTabs()}
              active={projects.active()}
              onSelect={projects.select}
              onMark={jumpTo}
              onRename={(path, name) => void projects.rename(path, name)}
              onClose={(path) => void projects.close(path)}
              onChoose={() => void projects.choose()}
            />
            <Show when={activeTab()?.exit}>
              {(exit) => (
                <>
                  <ErrorLine message={activeTab()?.reopenFailure ?? daemonExitText(exit())} />
                  <Reopen onReopen={() => void projects.reopen(activeTab()!.project.path)} busy={projects.reopening()} />
                </>
              )}
            </Show>
            <Show when={projects.tabs().length > 0 ? (projects.failure() ?? badgeFailure()) : badgeFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
          </>
        }
        rail={
          <Show when={projects.tabs().length > 0} fallback={<EmptyRail />}>
            <InProject open={activeConnection()}>
              {() => (
                <>
                  <Keys />
                  <Jump onFailure={setJumpFailure} />
                  <AttentionKey />
                  <Rail />
                </>
              )}
            </InProject>
          </Show>
        }
        centre={
          <Show when={projects.tabs().length > 0} fallback={<ChooseProject failure={projects.failure()} onChoose={() => void projects.choose()} />}>
            <InProject open={activeConnection()} failed={failureLine}>
              {(open) => {
                const tracked = emulators();

                return (
                  <div class="centre-stack">
                    <Pane notice={open.rail.failure() ?? jumpFailure()} createEmulator={tracked.create} />
                    <Thread selectionOf={tracked.selectionOf} />
                    <Help />
                  </div>
                );
              }}
            </InProject>
          </Show>
        }
        shelf={
          <Show when={projects.tabs().length > 0} fallback={<EmptyShelf />}>
            <InProject open={activeConnection()}>
              {() => (
                <>
                  <Todos />
                  <Pads />
                </>
              )}
            </InProject>
          </Show>
        }
        overlay={
          <InProject open={activeConnection()}>{(open) => <DrawerHost drawer={open.drawer} reducedMotion={open.reducedMotion} />}</InProject>
        }
      />
    </Show>
  );
};
