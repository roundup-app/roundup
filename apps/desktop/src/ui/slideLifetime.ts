import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

export type SlideLifetime = {
  /** A pointer slide toward the latest destination is running. */
  sliding: Accessor<boolean>;
  /** The layer is closing by slide: its content stays until the slide settles. */
  exiting: Accessor<boolean>;
  /** Retarget after changing the destination; observes its CSS animations after the DOM updates. */
  retarget: (open: boolean, animated: boolean) => void;
  /** Invalidate pending completion on an instant action, Project switch or removal. */
  settle: () => void;
};

/** U3010b: the browser owns completion; only the latest destination may release retained content. */
export const createSlideLifetime = (elements: Accessor<readonly (HTMLElement | undefined)[]>): SlideLifetime => {
  const [sliding, setSliding] = createSignal(false);
  const [exiting, setExiting] = createSignal(false);
  let revision = 0;
  let frame: number | undefined;

  const settle = () => {
    revision++;
    cancelAnimationFrame(frame ?? 0);
    setSliding(false);
    setExiting(false);
  };

  onCleanup(settle);

  return {
    sliding,
    exiting,
    settle,
    retarget: (open, animated) => {
      const current = ++revision;

      cancelAnimationFrame(frame ?? 0);

      setSliding(animated);
      setExiting(animated && !open);

      if (!animated) return;

      // Observe after the destination has reached the browser’s style/animation update.
      frame = requestAnimationFrame(() => {
        if (current !== revision) return;
        const hosts = elements().filter(element => element !== undefined);

        if (hosts.length === 0) return;
        const animations = hosts.flatMap(element => element.getAnimations?.() ?? []);
        const complete = () => { if (current === revision) settle(); };

        if (animations.length === 0) complete();
        else void Promise.allSettled(animations.map(animation => animation.finished)).then(complete);
      });
    },
  };
};
