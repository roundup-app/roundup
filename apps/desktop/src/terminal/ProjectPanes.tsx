import { provideFocusTarget } from "../keys/focus";
import { createEffect, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { Pane } from "./Pane";
import { doorTerminalId } from "../state/doorNode";
import { ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import type { EmulatorFactory } from "./emulator";
import type { Screens } from "./screens";

type Options = {
  active: () => string | null;
  connectionOf: (path: string) => ConnectedProject | undefined;
  createEmulator: () => EmulatorFactory;
  observeTerminal: (path: string, id: string | null) => void;
  arrival: (path: string) => ((move: () => void) => boolean) | undefined;
  focusPane: () => void;
  notice: () => string | null;
  openObject: (url: string, surface: string) => void;
};

/**
 * U7155a: each Project shown once keeps its Pane mounted, so a tab switch moves no Terminal and replays no output.
 * `view` renders the kept Panes; `screensOf` answers a Project's Terminal screens once its Pane has them.
 */
export const createProjectPanes = (options: Options) => {
  const [screens, setScreens] = createSignal<ReadonlyMap<string, Screens>>(new Map());

  const [shown, setShown] = createSignal<string[]>([]);

  // A Project keeps its Pane from its first connection until its connection ends.
  createEffect(() => {
    const active = options.active();
    const kept = untrack(shown);
    const next = kept.filter(path => options.connectionOf(path));

    if (active !== null && options.connectionOf(active) && !next.includes(active)) next.push(active);

    if (next.length !== kept.length || next.some((path, index) => path !== kept[index])) setShown(next);
  });

  const setScreen = (path: string, shared: Screens | undefined) => setScreens(known => {
    const next = new Map(known);

    if (shared) next.set(path, shared);
    else next.delete(path);

    return next;
  });

  /** Focus the Terminal of the Door selected in `open`'s Rail, or run `otherwise` when none is. */
  const focusSelected = (open: ConnectedProject, otherwise: () => void) => {
    const id = doorTerminalId(open.rail.nodes.find(node => node.id === open.rail.selected()));

    if (id) screens().get(open.project.path)?.emulatorFor(id).focus();
    else otherwise();
  };

  const pane = (open: ConnectedProject) => {
    const path = open.project.path;
    const tracked = options.createEmulator();
    const active = () => options.active() === path;

    onCleanup(() => setScreen(path, undefined));

    let host: HTMLDivElement | undefined;

    createEffect(on(active, now => {
      if (!now) return;

      // U7155a: only the shown Pane answers for the centre's Terminal.
      provideFocusTarget("pane.terminal", () => host?.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]") ?? null);

      const arrived = options.arrival(path);

      // U6371a: the Pane's effects have run by the next microtask; a user's own focus move since the switch has voided the request.
      if (arrived) queueMicrotask(() => arrived(() => focusSelected(open, options.focusPane)));
    }));

    return (
      <ConnectedProjectContext.Provider value={open}>
        <div ref={host} class="pane-host" data-inactive={active() ? undefined : ""} inert={!active()}>
          <Pane observeTerminal={active() ? id => options.observeTerminal(path, id) : undefined} notice={open.rail.failure() ?? (active() ? options.notice() : null) ?? open.contractNotice} retryNotice={open.rail.failure() !== null ? () => void open.rail.refresh({ terminals: true }) : undefined} createEmulator={tracked} screensRef={shared => setScreen(path, shared)} openObject={options.openObject} />
        </div>
      </ConnectedProjectContext.Provider>
    );
  };

  return {
    view: () => <For each={shown()}>{path => <Show when={options.connectionOf(path)} keyed>{open => pane(open)}</Show>}</For>,
    screensOf: (path: string): Screens | undefined => screens().get(path),
    focusSelected,
  };
};
