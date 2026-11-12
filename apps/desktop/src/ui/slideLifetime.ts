import { createEffect, createSignal, onCleanup } from "solid-js";
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

/** The pixels a running reveal still hides on the panel's leading edge. */
const hiddenLeft = (host: HTMLElement) => parseFloat(getComputedStyle(host).clipPath.match(/inset\(\S+ \S+ \S+ ([\d.]+)px\)/)?.[1] ?? "0");

/**
 * U4458, U3721b: a maximise or restore moves for real. The panel takes its final width at once, and a `clip-path`
 * reveals or hides its leading edge between the two widths; a restore pins the wider box until the reveal ends.
 */
export const createMaximiseSlide = (element: Accessor<HTMLElement | undefined>, active: Accessor<boolean>) => {
  let slide: Animation | undefined;

  const cancel = () => {
    const host = element();

    slide?.cancel();
    slide = undefined;

    if (host) host.style.minWidth = "";
  };

  createEffect(() => { if (!active()) cancel(); });
  onCleanup(cancel);

  return {
    cancel,
    /** The width the panel draws now, a running reveal included; read it before the size changes. */
    visibleWidth: () => {
      const host = element();

      return host ? host.getBoundingClientRect().width - (slide ? hiddenLeft(host) : 0) : 0;
    },
    /** Reveal from `before` to the width the panel has now; `key` picks the key duration (U6837a). */
    start: (before: number, key: boolean, settled: () => void = () => {}) => {
      cancel();
      const host = element();

      if (!active() || !host?.animate) return;
      const after = host.getBoundingClientRect().width;
      const hidden = Math.abs(after - before);

      if (hidden < 1) return;
      const style = getComputedStyle(host);
      const duration = style.getPropertyValue(key ? "--duration-key" : "--duration-drawer").trim();
      const grows = after > before;

      if (!grows) host.style.minWidth = `${before}px`;

      const inset = (px: number) => "inset(0 0 0 " + px + "px)";

      const current = host.animate([
        { clipPath: inset(grows ? hidden : 0) },
        { clipPath: inset(grows ? 0 : hidden) },
      ], { duration: parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000), easing: style.getPropertyValue("--easing-out").trim() });

      slide = current;

      const complete = () => {
        if (slide !== current) return;

        slide = undefined;
        host.style.minWidth = "";
        settled();
      };

      void current.finished.then(complete, complete);
    },
  };
};
