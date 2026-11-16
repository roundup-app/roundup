// fallow-ignore-file duplicate-export -- glyphOf finds a rendered Rail glyph; ink/glyph maps Kind to glyph data. Imports are direct.
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach } from "vitest";
import { createSignal, flush, Show, type Accessor } from "solid-js";
import type { TreeItemData } from "@ui-sdk/solid/tree";
import type { DaemonExit } from "../app/seam";
import type { Machine } from "@contracts/machine/Machine";
import type { Pad } from "@contracts/pad/Pad";
import type { RailNode } from "@contracts/agent/RailNode";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { createFakeApp } from "../testing/fakeApp";
import { info, NOW } from "../testing/nodes";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { DrawerHost } from "../drawer/DrawerHost";
import { Pane } from "../terminal/Pane";
import type { EmulatorFactory } from "../terminal/emulator";
import { AttentionKey } from "./AttentionKey";
import { createDockBadge } from "./DockBadge";
import { attentionHolders } from "./attention";
import { ProjectSettingsView } from "./ProjectSettings";
import { Rail } from "./Rail";
import { copy } from "./copy";

// Drafts survive unmount; unrelated layout fixtures retain their existing lifecycle.
afterEach(() => {
  for (const key of Object.keys(localStorage)) if (key.startsWith("roundup:drafts:")) localStorage.removeItem(key);
});

export const exitedTerminal = (id: string, exit_code: number | null): TerminalInfo =>
  info(`t-${id}`, { running: false, exit_code });

/** What else to mount alongside the Rail: a Pane (an `EmulatorFactory` gives it a focusable screen) or the DrawerHost. */
type RailNeighbors = { pane?: true | EmulatorFactory; drawer?: boolean; machines?: Machine[] };

/** The Rail on a fake Daemon whose tree is `tree` and whose clock is a signal the test can advance. */
export const mountRail = async (
  tree: RailNode[],
  terminals: TerminalInfo[] = [],
  daemonExit: Accessor<DaemonExit | null> = () => null,
  reducedMotion: () => boolean = () => false,
  neighbors: RailNeighbors = {},
  pads: Pad[] = [],
  project = { name: "p", path: "/p" },
  setup?: (app: ReturnType<typeof createFakeApp>) => void,
) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => terminals;
  app.handlers["pad.list"] = () => pads;
  app.handlers["machine.list"] = () => ({ machines: neighbors.machines ?? [], version: "0.1.21" });
  setup?.(app);

  const [now, setNow] = createSignal(NOW);
  const connected = await connectProject(app, project, reducedMotion, now, daemonExit);

  render(() => {
    connected.worktrees.watch(() => true);
    connected.machines.watch(() => true);
    createDockBadge({ app, rails: () => [{ alerts: "all", nodes: attentionHolders(connected.rail.nodes, connected.rail.terminals(), connected.rail.dismissed) }], onFailure: () => {} });

    return (
      <ConnectedProjectContext value={connected}>
        <AttentionKey />
        <Rail />
        <Show when={neighbors.pane}>
          <Pane createEmulator={neighbors.pane === true ? undefined : neighbors.pane} />
        </Show>
        <ProjectSettingsView />
        <Show when={neighbors.drawer}>
          <DrawerHost drawer={connected.drawer} reducedMotion={reducedMotion} />
        </Show>
      </ConnectedProjectContext>
    );
  });

  // The clock reads as soon as it moves, as a Solid 1 write did.
  return { app, rail: connected.rail, connected, setNow: (value: number) => { setNow(value); flush(); } };
};

/** The treeitem of the row named `name`: the element that carries `data-id`, `aria-level` and `aria-expanded`. */
export const itemOf = (name: string): HTMLElement => {
  const row = within(screen.getByRole("tree", { name: "Rail" })).getByText(name).closest<HTMLElement>("[role=treeitem]");

  if (!row) throw new Error(`no row for ${name}`);

  return row;
};

/** The row named `name` as the user focuses and clicks it: its treeitem, the same element as `itemOf` (imported by tests outside rail/). */
export const rowOf = itemOf;

/** The values of a tree's items at every depth, in walk order. */
export const itemValues = (items: readonly TreeItemData[]): string[] => items.flatMap(item => [item.value, ...itemValues(item.children ?? [])]);

export const rowGlyph = (name: string): HTMLElement => {
  const glyph = rowOf(name).querySelector<HTMLElement>(".glyph");

  if (!glyph) throw new Error(`no glyph on ${name}`);

  return glyph;
};

export const rowNames = (): string[] =>
  screen.getAllByRole("treeitem").filter((row) => row.hasAttribute("data-id") && !row.dataset.id?.startsWith("fold:")).map((row) => row.querySelector(".name")?.textContent ?? "");

export const tabbableRows = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[role="tree"] [role="treeitem"]:not(.section-head)')].filter((row) => row.tabIndex === 0);

export const railCallsTo = (app: ReturnType<typeof createFakeApp>, method: string) =>
  app.calls.filter((call) => call.method === method).map((call) => call.params);

/** A chord of the keyboard: `⌘` and `key` (U32). */
export const chord = (key: string): void => {
  fireEvent.keyDown(document, { key, metaKey: true });
};

/** U191: the one add in the pinned line. */
export const pinnedAdd = (): HTMLElement => screen.getByRole("button", { name: "Create" });

/** A key or a click lands on a later task: await this before asserting what the press did. */
export const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

/** Exercises the native action path without selecting or opening its row. */
export const chooseAction = async (app: ReturnType<typeof createFakeApp>, name: string, label: string) => {
  fireEvent.contextMenu(rowOf(name), { clientX: 1, clientY: 1 });
  await app.pickMenu(label);
};

/** The exited row's play icon, labelled Restart: it sends `agent.resume {id, mode}` (U428, U7191a). */
export const resumeRow = (name: string): void => {
  fireEvent.click(within(rowOf(name)).getByRole("button", { name: copy.restart }));
};

/** Chooses a creation kind through the shared footer menu. */
export const chooseFooter = async (name: "Agent" | "Workstream" | "Mode"): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: "Create" }));
  const item = await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) });
  fireEvent.click(item);
  await waitFor(() => { if (screen.queryByRole("menu")) throw new Error("Creation menu remains open"); });
};
