import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

/** Longest a pointer slide may run before it is taken as complete, when no `transitionend` arrives. */
const SLIDE_FALLBACK_MS = 600;

export type SlideLifetime = {
  /** A pointer slide toward the latest destination is running. */
  sliding: Accessor<boolean>;
  /** The layer is closing by slide: its content stays until the slide settles. */
  exiting: Accessor<boolean>;
  /** The latest destination wins: replaces any running slide and its timer; `animated: false` settles at once. */
  retarget: (open: boolean, animated: boolean) => void;
  /** The slide's completion, from its `transitionend` or from a Project switch; ends whatever slide runs now. */
  settle: () => void;
};

/**
 * U3010b: the one owner of a layer's slide lifetime, shared by the Drawer and the Shelf. Callers declare the
 * destination and whether it animates, and report completion; the fallback timer, cancellation of a superseded
 * slide and exit retention stay here. Content, focus and business effects stay with the caller.
 */
export const createSlideLifetime = (): SlideLifetime => {
  const [sliding, setSliding] = createSignal(false);
  const [exiting, setExiting] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    clearTimeout(timer);
    setSliding(false);
    setExiting(false);
  };

  onCleanup(settle);

  return {
    sliding,
    exiting,
    settle,
    retarget: (open, animated) => {
      settle();

      if (!animated) return;

      setSliding(true);
      setExiting(!open);
      timer = setTimeout(settle, SLIDE_FALLBACK_MS);
    },
  };
};
