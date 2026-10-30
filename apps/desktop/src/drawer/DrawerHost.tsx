import { CHORDS } from "../keys/chords";
import Maximize from "lucide-solid/icons/maximize";
import Minimize from "lucide-solid/icons/minimize";
import { createShelfFrame } from "../shelf/frame";
import { captureFocus } from "../keys/focus";
import { activationSource } from "../keys/registry";
import { registerKeys } from "../keys/registry";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import { createContext, createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../ink/Icon";
import { DRAWER_EASING, fillsCentre } from "./drawer";
import { createMaximiseSlide, createSlideLifetime } from "../ui/slideLifetime";
import { setDrawerSliding } from "./sliding";
import type { ActivationSource } from "../keys/registry";
import type { DrawerContent, DrawerState } from "./drawer";

export const DrawerExpandContext = createContext<(host: HTMLElement | undefined) => void>();

/**
 * An overlay: absolutely positioned over the Shelf, at the window's right edge. The centre narrows by the
 * Drawer's width with the same transition (U430), so the Drawer covers none of it.
 */
export const DrawerHost = (props: { drawer: DrawerState; reducedMotion: Accessor<boolean> }) => {
  const [mounted, setMounted] = createSignal<DrawerContent | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement>();
  const frame = createShelfFrame(() => props.drawer.surface()?.project ?? null, props.reducedMotion, undefined, undefined, () => props.drawer.surface()?.kind ?? "drawer", fillsCentre);
  const maximiseSlide = createMaximiseSlide(panel, () => props.drawer.content() !== null && !props.reducedMotion());

  const toggleMaximise = (source: ActivationSource) => {
    const host = panel();
    const left = host?.getBoundingClientRect().left;
    maximiseSlide.cancel();
    frame.toggleMaximise(source);

    if (host && left !== undefined && source !== "key") maximiseSlide.start(left - host.getBoundingClientRect().left);
  };

  const [expandHost, setExpandHost] = createSignal<HTMLElement>();

  const expand = () => (
    <IconButton chord={CHORDS.find(row => row.keys === "M")} aria-label={frame.maximised() ? copy.restore : copy.maximise} onClick={event => toggleMaximise(activationSource(event))}>
      <Show when={frame.maximised()} fallback={<Maximize class="icon" aria-hidden="true" />}><Minimize class="icon" aria-hidden="true" /></Show>
    </IconButton>
  );

  const [edgeHovered, setEdgeHovered] = createSignal(false);
  const isOpen = () => props.drawer.content() !== null;
  const instant = () => props.reducedMotion() || props.drawer.source() === "key";
  const [settling, setSettling] = createSignal(false);
  let settleFrame: number | undefined;
  let revision = 0;
  let savedFocus: HTMLElement | null = null;
  let savedRegion: HTMLElement | null = null;

  // U40: opening takes the keyboard; closing gives it back to whatever kept it, unless focus left the Drawer on its own.
  createEffect(
    on(isOpen, (open, wasOpen) => {
      const host = panel();

      if (open && !wasOpen) {
        savedFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        savedRegion = savedFocus?.closest<HTMLElement>("[data-history-region]") ?? null;
        captureFocus()(() => host?.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true }));
      } else if (wasOpen && !open) {
        const stayedInDrawer = host?.contains(document.activeElement) ?? false;
        const firstRow = savedRegion?.querySelector<HTMLElement>('.todo-row-button, .pad-name, [data-id][data-part="item"], [data-id] [data-part="branch-control"]');
        const toRefocus = savedFocus?.isConnected ? savedFocus : firstRow ?? savedRegion;

        const regionDestination = toRefocus === savedRegion;
        savedFocus = null;
        savedRegion = null;

        if (stayedInDrawer && toRefocus?.isConnected) captureFocus()(() => {
          if (regionDestination && !toRefocus.hasAttribute("tabindex")) toRefocus.tabIndex = -1;
          toRefocus.focus({ preventScroll: true });
        });
      }
    }),
  );

  // U430: the centre moves for as long as the slide runs; with no motion there is no slide.
  const lifetime = createSlideLifetime(() => [panel()]);

  createEffect(() => setDrawerSliding(lifetime.sliding()));
  onCleanup(() => setDrawerSliding(false));
  createEffect(on(lifetime.exiting, (exiting, was) => { if (was && !exiting && !isOpen()) setMounted(null); }));

  createEffect(
    on(() => [props.drawer.content(), props.drawer.source(), props.reducedMotion()] as const, (_action, previous) => {
      const current = ++revision;
      cancelAnimationFrame(settleFrame ?? 0);
      setSettling(previous !== undefined && instant());
      const content = props.drawer.content();

      if (content !== null) setMounted(() => content);
      else if (instant()) setMounted(null);

      if (previous === undefined) return;

      // U3010b: a preference change alone settles; turning reduced motion off replays no slide.
      const preferenceOnly = previous[0] === props.drawer.content() && previous[1] === props.drawer.source();

      lifetime.retarget(isOpen(), !instant() && !preferenceOnly);

      if (!instant()) return;

      // Flush the settled layout before restoring the Shelf's own transition policy.
      queueMicrotask(() => {
        if (current !== revision || !panel()?.isConnected) return;
        void panel()!.offsetWidth;
        settleFrame = requestAnimationFrame(() => setSettling(false));
      });
    }),
  );

  onCleanup(() => { revision++; cancelAnimationFrame(settleFrame ?? 0); });

  const canMaximise = (focus: Element | null) => isOpen() && !!focus && !!panel()?.contains(focus) && !focus.closest('input, textarea, select, [contenteditable], .xterm, .pane-screen, [role=dialog], [role=menu]');

  registerKeys({ kind: "layer", element: panel, active: isOpen, modal: false }, [{
    chords: ["Escape"],
    when: (press) => !(press.target instanceof Element && press.target.closest('input, textarea, [contenteditable], .xterm, .pane-screen')),
    run: () => { captureFocus(true); props.drawer.close("key"); },
  }, {
    action: CHORDS.find(row => row.keys === "M")!,
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
      data-open={isOpen()}
      data-maximised={frame.maximised()}
      data-fill={frame.maximised() && fillsCentre(props.drawer.surface()?.kind)}
      data-mounted={mounted() !== null}
      data-motion={instant() ? "none" : "slide"}
      data-settling={settling()}
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
        transition: instant() ? "none" : `transform var(--duration-drawer) ${DRAWER_EASING}`,
      }}

    >
      <div class="drawer-controls">
        <Show when={expandHost()} fallback={expand()}>{target => <Portal mount={target()}><div class="pad-toolbar-expand">{expand()}</div></Portal>}</Show>
        <IconButton class="close" aria-label={copy.close} onClick={(event) => props.drawer.close(activationSource(event))}>
          <Icon name="x" />
        </IconButton>
      </div>
      <Show when={mounted()} keyed>
        {(content) => <DrawerExpandContext.Provider value={setExpandHost}>{content()}</DrawerExpandContext.Provider>}
      </Show>
    </aside>
  );
};
