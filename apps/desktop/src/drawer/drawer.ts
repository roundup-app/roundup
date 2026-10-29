import { captureFocus } from "../keys/focus";
import type { ActivationSource } from "../keys/registry";
import { batch, createSignal } from "solid-js";
import type { Accessor, JSX } from "solid-js";

export type DrawerContent = () => JSX.Element;

export type DrawerState = {
  /** The one Drawer that is open, or `null`. */
  content: Accessor<DrawerContent | null>;
  /** Replaces whatever Drawer is open. */
  open(content: DrawerContent, source?: ActivationSource, surface?: { kind: string; project: string }): void;
  surface: Accessor<{ kind: string; project: string } | null>;
  close(source?: ActivationSource): void;
  source: Accessor<ActivationSource>;
};

/** U4698a: Todo and Pad open filling the centre pane unless their Project shrank them. */
export const fillsCentre = (kind: string | undefined) => kind === "todo" || kind === "pad";

export const DRAWER_EASING = "var(--easing-out)";

export const createDrawer = (): DrawerState => {
  const [content, setContent] = createSignal<DrawerContent | null>(null);

  const [surface, setSurface] = createSignal<{ kind: string; project: string } | null>(null);
  const [source, setSource] = createSignal<ActivationSource>("pointer");

  return {
    content,
    source,
    surface,
    open: (next, from = "pointer", side) => batch(() => { captureFocus(true); setSurface(side ?? null); setSource(from); setContent(() => next); }),
    close: (from = "pointer") => batch(() => { setSource(from); setContent(null); }),
  };
};
