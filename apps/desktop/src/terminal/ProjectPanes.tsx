import { createEffect, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { Pane } from "./Pane";
import { isDoor } from "../state/doorNode";
import { ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
import type { EmulatorFactory } from "./emulator";
import type { Screens } from "./screens";

type Options = {
  keys: () => string[];
  active: () => string | null;
  connectionOf: (path: string) => ConnectedProject | undefined;
  ready: () => boolean;
  createEmulator: () => EmulatorFactory;
  observeTerminal: ((path: string, id: string | null) => void) | undefined;
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
  const [shown, setShown] = createSignal<string[]>([]);
  const [screens, setScreens] = createSignal<ReadonlyMap<string, Screens>>(new Map());

  createEffect(() => {
    const open = options.keys();
    const active = options.active();
    const kept = untrack(shown);
    const next = kept.filter(path => open.includes(path));

    if (active !== null && options.ready() && open.includes(active) && !next.includes(active)) next.push(active);

    if (next.length !== kept.length || next.some((path, index) => path !== kept[index])) setShown(next);
  });

  const pane = (open: ConnectedProject) => {
    const path = open.project.path;
    const tracked = options.createEmulator();
    const active = () => options.active() === path;

    onCleanup(() => setScreens(known => {
      const next = new Map(known);

      next.delete(path);

      return next;
    }));

    // U6371a: the Pane's effects have run by the next microtask; a user's own focus move since the switch has voided the request.
    createEffect(on(active, now => {
      const arrived = now ? options.arrival(path) : undefined;

      if (arrived) queueMicrotask(() => arrived(() => {
        const node = open.rail.nodes.find(candidate => candidate.id === open.rail.selected());
        const id = node && isDoor(node) ? node.terminal_id : undefined;

        if (id) screens().get(path)?.emulatorFor(id).focus();
        else options.focusPane();
      }));
    }));

    return (
      <ConnectedProjectContext.Provider value={open}>
        <div class="pane-host" data-inactive={active() ? undefined : ""} inert={!active()}>
          <Pane active={active} observeTerminal={options.observeTerminal && active() ? id => options.observeTerminal?.(path, id) : undefined} notice={open.rail.failure() ?? (active() ? options.notice() : null) ?? open.contractNotice} retryNotice={open.rail.failure() !== null ? () => void open.rail.refresh({ terminals: true }) : undefined} createEmulator={tracked} screensRef={shared => setScreens(known => new Map(known).set(path, shared))} openObject={options.openObject} />
        </div>
      </ConnectedProjectContext.Provider>
    );
  };

  return {
    view: () => <For each={shown()}>{path => <Show when={options.connectionOf(path)} keyed>{open => pane(open)}</Show>}</For>,
    screensOf: (path: string): Screens | undefined => screens().get(path),
  };
};
