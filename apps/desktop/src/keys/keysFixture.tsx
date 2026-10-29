import { Portal } from "solid-js/web";
import { Dialog } from "../ui/Dialog";
import { Menu } from "../ui/Menu";
import { registerKeys } from "./registry";
import { render } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { DrawerHost } from "../drawer/DrawerHost";
import { Rail } from "../rail/Rail";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { NOW } from "../testing/nodes";
import { Pane } from "../terminal/Pane";
import type { EmulatorFactory } from "../terminal/emulator";

/** What else to mount alongside the Rail and `Keys`: a Pane (an `EmulatorFactory` gives it a focusable screen) or the DrawerHost. */
type KeysNeighbors = { pane?: EmulatorFactory; drawer?: boolean };

/** The Rail on a fake Daemon whose tree is `tree`, as `railFixture`'s `mountRail` sets up for U31 and U32. */
export const mountKeys = async (tree: RailNode[], neighbors: KeysNeighbors = {}) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => tree;

  const [now] = createSignal(NOW);
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, now, () => null);

  render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <Rail />
      <Show when={neighbors.pane}>
        <Pane createEmulator={neighbors.pane} />
      </Show>
      <Show when={neighbors.drawer}>
        <DrawerHost drawer={connected.drawer} reducedMotion={() => false} />
      </Show>
    </ConnectedProjectContext.Provider>
  ));

  await connected.rail.settled();

  return { app, rail: connected.rail, connected };
};


/** Isolated registry consumer: Ark retains dismissal and focus return; the Drawer binds only its own Escape. */
export const mountRegistryLayers = (reverse: boolean, nested: boolean, editors = false) => {
  const [drawerOpen, setDrawerOpen] = createSignal(true);
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  let drawer: HTMLElement | undefined;
  let dialog: HTMLDivElement | undefined;
  let menu: HTMLDivElement | undefined;
  let origin: HTMLButtonElement | undefined;

  const close = () => {
    const restore = drawer?.contains(document.activeElement);
    setDrawerOpen(false);

    if (restore) origin?.focus();
  };

  const guarded = (event: KeyboardEvent) => !(event.target instanceof Element && event.target.closest("input, textarea, [contenteditable], .xterm"));

  const Drawer = () => {
    registerKeys({ kind: "layer", element: () => drawer, active: drawerOpen, modal: false }, [{ chords: ["Escape"], when: guarded, run: close }]);

    return <Show when={drawerOpen()}><aside ref={drawer} class="drawer" data-registry-drawer tabIndex={-1} style={{ position: "fixed", top: "calc(var(--space-5) * 2)", right: "0", bottom: "0", width: "var(--shelf-width)", "z-index": "var(--layer-drawer)" }}>
      <button data-registry-modal-trigger data-button="quiet" onClick={() => setDialogOpen(true)}>Open modal</button>
      <Menu.Root open={menuOpen()} onOpenChange={(details) => setMenuOpen(details.open)}>
        <Menu.Trigger data-registry-menu-trigger data-button="quiet">Project menu</Menu.Trigger>
        <Portal><Menu.Positioner><Menu.Content ref={menu} style={{ "z-index": "var(--layer-menu)" }}>
          <Menu.Item value="project">Project action</Menu.Item>
        </Menu.Content></Menu.Positioner></Portal>
      </Menu.Root>
      <Show when={editors}><input aria-label="Drawer input" />
      <textarea aria-label="Drawer text" />
      <div contentEditable tabIndex={0}>Editable content</div>
      <div class="xterm" tabIndex={0}>Terminal</div></Show>
      <p>Unchanged Drawer content</p>
    </aside></Show>;
  };

  const Top = () => {
    registerKeys({ kind: "layer", element: () => dialog, active: dialogOpen, modal: true }, []);
    registerKeys({ kind: "layer", element: () => menu, active: menuOpen, modal: false }, []);

    return <Dialog.Root open={dialogOpen()} onOpenChange={(details) => setDialogOpen(details.open)} restoreFocus>
      <Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content ref={dialog} style={{ position: "fixed", top: "calc(var(--space-5) * 2)", right: "var(--space-4)", width: "var(--shelf-width)", "z-index": "var(--layer-dialog)" }}>
        <Dialog.Title>Registry modal</Dialog.Title><Dialog.Description>Top layer owns Escape</Dialog.Description>
        <Dialog.CloseTrigger data-button="quiet">Close modal</Dialog.CloseTrigger>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>;
  };

  return render(() => <div data-registry-fixture>
    <button ref={origin} data-button="quiet" data-registry-origin>Drawer origin</button>
    {reverse && <Top />}
    {nested ? <main><section aria-label="Drawer region"><Drawer /></section></main> : <section aria-label="Drawer region"><Drawer /></section>}
    {!reverse && <Top />}
  </div>, { container: document.body });
};
