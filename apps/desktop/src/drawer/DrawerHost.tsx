import { registerKeys } from "../keys/registry";
import { IconButton } from "../ui";
import { copy } from "../copy";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Icon } from "../ink/Icon";
import { DRAWER_EASING } from "./drawer";
import { setDrawerSliding } from "./sliding";
import type { DrawerContent, DrawerState } from "./drawer";

/**
 * An overlay: absolutely positioned over the Shelf, at the window's right edge. The centre narrows by the
 * Drawer's width with the same transition (U430), so the Drawer covers none of it (GLOSSARY.md, Drawer).
 */
export const DrawerHost = (props: { drawer: DrawerState; reducedMotion: Accessor<boolean> }) => {
  const [mounted, setMounted] = createSignal<DrawerContent | null>(null);
  const [panel, setPanel] = createSignal<HTMLElement>();
  const isOpen = () => props.drawer.content() !== null;
  let heldFocus: HTMLElement | null = null;

  // Content stays mounted until the slide-out ends; with no transition no `transitionend` fires, so it goes at once.
  createEffect(() => {
    const content = props.drawer.content();

    if (content !== null) setMounted(() => content);
    else if (props.reducedMotion()) setMounted(null);
  });

  // U40: opening takes the keyboard; closing gives it back to whatever held it, unless focus left the Drawer on its own.
  createEffect(
    on(isOpen, (open, wasOpen) => {
      const host = panel();

      if (open && !wasOpen) {
        heldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        host?.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true });
      } else if (wasOpen && !open) {
        const stayedInDrawer = host?.contains(document.activeElement) ?? false;
        const toRefocus = heldFocus;

        heldFocus = null;

        if (stayedInDrawer && toRefocus?.isConnected) toRefocus.focus({ preventScroll: true });
      }
    }),
  );

  // U430: the centre moves for as long as the slide runs; with no motion there is no slide.
  let slideTimer: ReturnType<typeof setTimeout> | undefined;

  const endSlide = () => {
    clearTimeout(slideTimer);
    setDrawerSliding(false);
  };

  createEffect(
    on(isOpen, () => {
      if (props.reducedMotion()) return;

      setDrawerSliding(true);
      clearTimeout(slideTimer);
      slideTimer = setTimeout(endSlide, 600);
    }, { defer: true }),
  );

  onCleanup(endSlide);

  registerKeys({ kind: "layer", element: panel, active: isOpen, modal: false }, [{
    chords: ["Escape"],
    when: (press) => !(press.target instanceof Element && press.target.closest('input, textarea, [contenteditable], .xterm, .pane-screen')),
    run: () => props.drawer.close(),
  }]);

  return (
    <aside
      class="drawer"
      aria-label={copy.drawer}
      inert={!isOpen()}
      data-open={isOpen()}
      data-motion={props.reducedMotion() ? "none" : "slide"}
      ref={setPanel}
      style={{
        position: "absolute",
        top: "0",
        right: "0",
        bottom: "0",
        transform: isOpen() ? "translateX(0)" : "translateX(100%)",
        transition: props.reducedMotion() ? "none" : `transform var(--duration-drawer) ${DRAWER_EASING}`,
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) endSlide();

        if (!isOpen()) setMounted(null);
      }}
    >
      <IconButton class="close" aria-label={copy.close} onClick={() => props.drawer.close()}>
        <Icon name="x" />
      </IconButton>
      <Show when={mounted()} keyed>
        {(content) => content()}
      </Show>
    </aside>
  );
};
