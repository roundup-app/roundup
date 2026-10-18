import { batch, createSignal } from "solid-js";
import type { Accessor, JSX } from "solid-js";

export type DrawerContent = () => JSX.Element;

export type DrawerState = {
  /** The one Drawer that is open, or `null`. */
  content: Accessor<DrawerContent | null>;
  /** Replaces whatever Drawer is open. */
  open(content: DrawerContent, source?: "key" | "pointer"): void;
  close(source?: "key" | "pointer"): void;
  source: Accessor<"key" | "pointer">;
};

export const DRAWER_EASING = "var(--easing-out)";

export const createDrawer = (): DrawerState => {
  const [content, setContent] = createSignal<DrawerContent | null>(null);

  const [source, setSource] = createSignal<"key" | "pointer">("pointer");

  return {
    content,
    source,
    open: (next, from = "pointer") => batch(() => { setSource(from); setContent(() => next); }),
    close: (from = "pointer") => batch(() => { setSource(from); setContent(null); }),
  };
};
