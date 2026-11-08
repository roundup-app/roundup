import { createEffect, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import { createSlideLifetime } from "../ui/slideLifetime";
import type { Widths } from "../resize/widths";
import { setRailSliding } from "./sliding";

/** U6228g: how the Rail's section reads while it folds or opens: the strip shows through a slide, and an opening Rail is drawn as a peek over the centre until the column widens. */
export const railView = (widths: Widths | undefined, peeking: boolean | undefined) => {
  const collapsed = widths?.collapsed() === true;
  const laidOut = widths?.laidOut() === true;

  return { strip: collapsed || laidOut, peek: peeking === true || (laidOut && !collapsed) };
};

/** U6228g: folds and opens the Rail by sliding it over the centre, which keeps its width until the slide ends; a key slides in the key duration, and reduced motion fades. */
export const createRailSlide = (widths: Widths, reducedMotion: Accessor<boolean>) => {
  const lifetime = createSlideLifetime(() => [document.querySelector<HTMLElement>(".rail-body") ?? undefined]);
  const [motion, setMotion] = createSignal<"click" | "key" | "fade">();

  createEffect(() => setRailSliding(lifetime.sliding()));
  createEffect(on(lifetime.sliding, (sliding) => {
    if (sliding) return;
    widths.settleLayout();
    setMotion(undefined);
  }));

  return {
    motion,
    set: (collapsed: boolean, source: "click" | "key") => {
      // Without animations (a test DOM) the change is instant and settles at once.
      const animated = document.querySelector(".rail-body") !== null && "getAnimations" in Element.prototype;

      setMotion(reducedMotion() ? "fade" : source);
      widths.setCollapsed(collapsed, animated);

      if (animated) queueMicrotask(() => lifetime.retarget(!collapsed, true));
      else lifetime.settle();
    },
  };
};
