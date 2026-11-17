import { isFocusFromKeyboard } from "@ui-sdk/core";
import { surfaceOpen } from "../ui/openSurfaces";
import { CHORDS } from "../keys/chords";
import Maximize from "@lucide/solid/icons/maximize";
import Minimize from "@lucide/solid/icons/minimize";
import { createShelfFrame } from "../shelf/frame";
import { captureFocus, focusCentre } from "../keys/focus";
import { activationSource } from "../keys/registry";
import { registerKeys } from "../keys/registry";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import { ConnectedProjectContext } from "../state/connectedProject";
import { useContext, createContext, createEffect, createMemo, createSignal, onCleanup, Show, untrack, type Accessor } from "solid-js";
import { Portal } from "@solidjs/web";
import { Icon } from "../ink/Icon";
import { DRAWER_EASING, fillsCentre } from "./drawer";
import { createMaximiseSlide, createSlideLifetime } from "../ui/slideLifetime";
import { setDrawerSliding } from "./sliding";
import type { ActivationSource } from "../keys/registry";
import type { DrawerContent, DrawerState } from "./drawer";

export const DrawerMaximisedContext = createContext<Accessor<boolean>>(() => false);

export const DrawerExpandContext = createContext<((host: HTMLElement | undefined) => void) | null>(null);

/**
 * An overlay: absolutely positioned over the Shelf, at the window's right edge. The centre narrows by the
 * Drawer's width with the same transition (U430), so the Drawer covers none of it.
 */
export const DrawerHost = (props: { drawer: DrawerState; reducedMotion: Accessor<boolean> }) => {
  const connected = useContext(ConnectedProjectContext);
  let openingSelection: string | null | undefined;
  const [mounted, setMounted] = createSignal<DrawerContent | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement>();
  const frame = createShelfFrame(() => props.drawer.surface()?.project ?? null, props.reducedMotion, undefined, undefined, () => props.drawer.surface()?.kind ?? "drawer", fillsCentre);
  const maximiseSlide = createMaximiseSlide(panel, () => props.drawer.content() !== null && !props.reducedMotion());

  const toggleMaximise = (source: ActivationSource) => {
    const before = maximiseSlide.visibleWidth();
    maximiseSlide.cancel();
    frame.toggleMaximise(source);
    maximiseSlide.start(before, source === "key");
  };

  createEffect(() => props.drawer, drawer => drawer.bindSize(() => ({ maximised: frame.maximised(), toggle: toggleMaximise })));

  const [expandHost, setExpandHost] = createSignal<HTMLElement>();

  const expand = () => (
    <IconButton action="shelf.maximise" aria-label={frame.maximised() ? copy.restore : copy.maximise} onClick={event => toggleMaximise(activationSource(event))}>
      <Show when={frame.maximised()} fallback={<Maximize class="icon" aria-hidden="true" />}><Minimize class="icon" aria-hidden="true" /></Show>
    </IconButton>
  );

  const [edgeHovered, setEdgeHovered] = createSignal(false);
  const isOpen = createMemo(() => props.drawer.content() !== null);
  const instant = () => props.reducedMotion();
  const [settling, setSettling] = createSignal(false);
  let settleFrame: number | undefined;
  let revision = 0;
  let savedFocus: HTMLElement | null = null;
  let savedRegion: HTMLElement | null = null;

  // U40: opening takes the keyboard; closing gives it back to whatever kept it, unless focus left the Drawer on its own.
  createEffect(isOpen, (open, wasOpen) => {
    const host = untrack(panel);

    if (open && !wasOpen) {
      openingSelection = untrack(() => connected?.rail.selected());
      savedFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      savedRegion = savedFocus?.closest<HTMLElement>("[data-history-region]") ?? null;
      captureFocus()(() => host?.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true }));
    } else if (wasOpen && !open) {
      const stayedInDrawer = host?.contains(document.activeElement) ?? false;
      const firstRow = savedRegion?.querySelector<HTMLElement>('.todo-row-button, .pad-name, [data-id][role="treeitem"]');
      const toRefocus = savedFocus?.isConnected ? savedFocus : firstRow ?? savedRegion;

      const regionDestination = toRefocus === savedRegion;
      savedFocus = null;
      savedRegion = null;

      if (stayedInDrawer && untrack(() => connected?.rail.selected()) === openingSelection) captureFocus()(() => {
        // U7158: a Terminal running in the centre takes the keyboard back; the return to the row holds when none runs.
        if (focusCentre() || !toRefocus?.isConnected) return;

        if (regionDestination && !toRefocus.hasAttribute("tabindex")) toRefocus.tabIndex = -1;
        toRefocus.focus({ preventScroll: true });
      });
    }
  });

  // U64: a different chosen row dismisses the Drawer; its Terminal owns focus after readiness.
  createEffect(() => connected?.rail.selected(), (id, previous) => {
    if (id != null && id !== previous) props.drawer.close(isFocusFromKeyboard() ? "key" : "pointer");
  }, { defer: true });

  // U430: the centre moves for as long as the slide runs; with no motion there is no slide.
  const lifetime = createSlideLifetime(() => [panel()]);

  createEffect(() => lifetime.sliding(), sliding => { setDrawerSliding(sliding); });
  onCleanup(() => setDrawerSliding(false));
  createEffect(lifetime.exiting, (exiting, was) => { if (was && !exiting && !untrack(isOpen)) setMounted(null); });

  createEffect(
    () => [props.drawer.content(), props.drawer.source(), props.reducedMotion()] as const,
    ([content, source, reduced], previous) => {
      const current = ++revision;
      cancelAnimationFrame(settleFrame ?? 0);
      setSettling(previous !== undefined && reduced);

      if (content !== null) setMounted(() => content);
      else if (reduced) setMounted(null);

      if (previous === undefined) return;

      // U3010b: a preference change alone settles; turning reduced motion off replays no slide.
      const preferenceOnly = previous[0] === content && previous[1] === source;

      lifetime.retarget(content !== null, !reduced && !preferenceOnly);

      if (!reduced) return;

      // Flush the settled layout before restoring the Shelf's own transition policy.
      queueMicrotask(() => {
        if (current !== revision || !panel()?.isConnected) return;
        void panel()!.offsetWidth;
        settleFrame = requestAnimationFrame(() => setSettling(false));
      });
    },
  );

  // U3721b: the centre takes the Drawer's width once, when its slide ends; a width never interpolates.
  const reserve = createMemo<boolean>(prev => lifetime.sliding() ? (prev ?? untrack(isOpen)) : isOpen());

  onCleanup(() => { revision++; cancelAnimationFrame(settleFrame ?? 0); });

  const canMaximise = (focus: Element | null) => isOpen() && !!focus && !!panel()?.contains(focus) && !focus.closest('input, textarea, select, [contenteditable], .xterm, .pane-screen, [role=dialog], [role=menu]');

  registerKeys({ kind: "layer", element: panel, active: isOpen, modal: false }, [{
    chords: ["Escape"],
    when: (press) => !surfaceOpen() && !(press.target instanceof Element && press.target.closest('input, textarea, [contenteditable], .xterm, .pane-screen, [role=menu], [role=menuitem]')),
    run: () => { captureFocus(true); props.drawer.close("key"); },
  }, {
    action: CHORDS["shelf.maximise"],
    when: press => canMaximise(press.target instanceof Element ? press.target : null),
    capture: focus => ({
      available: () => canMaximise(focus),
      invoke: () => toggleMaximise("key"),
    }),
  }]);

  return (
    <aside
      class="drawer"
      aria-label={copy.drawer}
      inert={!isOpen()}
      data-open={String(isOpen())}
      data-maximised={String(frame.maximised())}
      data-fill={String(frame.maximised() && fillsCentre(props.drawer.surface()?.kind))}
      data-mounted={String(mounted() !== null)}
      data-reserve={String(reserve())}
      data-motion={instant() ? "none" : "slide"}
      data-settling={String(settling())}
      ref={setPanel}
      onPointerMove={(event) => {
        const host = event.currentTarget;
        const x = event.clientX - host.getBoundingClientRect().left;
        setEdgeHovered(event.target === host && x >= 0 && x < parseFloat(getComputedStyle(host).borderLeftWidth));
      }}
      onPointerLeave={() => setEdgeHovered(false)}
      onPointerDown={(event) => {
        const host = event.currentTarget;
        const x = event.clientX - host.getBoundingClientRect().left;

        // Only the visible border dismisses; a missed content press in the padding keeps its work open.
        if (event.button !== 0 || event.target !== host || x < 0 || x >= parseFloat(getComputedStyle(host).borderLeftWidth)) return;

        event.preventDefault();
        props.drawer.close("pointer");
      }}
      style={{
        cursor: edgeHovered() ? "pointer" : undefined,
        position: "absolute",
        top: "0",
        right: "var(--drawer-right)",
        bottom: "var(--drawer-bottom)",
        transform: isOpen() ? "translateX(0)" : "translateX(calc(100% + var(--drawer-right)))",
        transition: instant() ? "none" : `transform ${props.drawer.source() === "key" ? "var(--duration-key)" : "var(--duration-drawer)"} ${DRAWER_EASING}`,
      }}

    >
      <div class="drawer-controls">
        <Show when={expandHost()} fallback={expand()}>{target => <Portal mount={target()}><div class="pad-toolbar-expand">{expand()}</div></Portal>}</Show>
        <IconButton icon="close" class="close" aria-label={copy.close} onClick={(event) => props.drawer.close(activationSource(event))}>
          <Icon name="x" />
        </IconButton>
      </div>
      <Show when={mounted()} keyed>
        {(content) => <DrawerMaximisedContext value={frame.maximised}><DrawerExpandContext value={setExpandHost}>{content()}</DrawerExpandContext></DrawerMaximisedContext>}
      </Show>
    </aside>
  );
};
