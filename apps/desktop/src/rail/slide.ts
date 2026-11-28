import { createEffect, createSignal, type Accessor } from "solid-js";
import { createSlideLifetime } from "../ui/slideLifetime";
import type { Widths } from "../resize/widths";
import type { ActivationSource } from "../keys/registry";
import type { ShelfFrame } from "../shelf/frame";
import { railSliding, setRailSliding } from "./sliding";

/** U6228g: how the Rail's section reads while it folds or opens: the strip shows through a slide, and an opening Rail is drawn as a peek over the centre until the column widens. */
export const railView = (widths: Widths | undefined, peeking: boolean | undefined) => {
  const collapsed = widths?.collapsed() === true;
  // A fold cancelled mid-slide has `collapsed` false while the column is not yet a strip: it still draws as a peek, so it reverses from where it is.
  const laidOut = widths?.laidOut() === true || railSliding();

  return { strip: collapsed || laidOut, peek: peeking === true || (laidOut && !collapsed) };
};

/** U6228g: folds and opens the Rail by sliding it over the centre, which keeps its width until the slide ends; a key slides in the key duration, and reduced motion fades. */
export const createRailSlide = (widths: Widths, reducedMotion: Accessor<boolean>) => {
  const lifetime = createSlideLifetime(() => [document.querySelector<HTMLElement>(".rail-body") ?? undefined]);
  const [motion, setMotion] = createSignal<"click" | "key" | "fade">();

  createEffect(lifetime.sliding, sliding => { setRailSliding(sliding); });
  createEffect(lifetime.sliding, sliding => {
    if (sliding) return;
    widths.settleLayout();
    setMotion(undefined);
  });

  return {
    motion,
    set: (collapsed: boolean, source: "click" | "key", remember = true) => {
      // Without animations (a test DOM) the change is instant and settles at once.
      const animated = document.querySelector(".rail-body") !== null && "getAnimations" in Element.prototype;

      setMotion(reducedMotion() ? "fade" : source);
      widths.setCollapsed(collapsed, animated, remember);

      if (animated) queueMicrotask(() => lifetime.retarget(!collapsed, true));
      else lifetime.settle();
    },
  };
};

const motionOf = (source: ActivationSource) => source === "key" ? "key" : "click";

/** U8005a: Changes folds the Rail and closes the Bench without saving; closing it restores each one the user has not touched since. */
export const createChangesFold = (changesOpen: Accessor<boolean>, widths: Pick<Widths, "collapsed">, railSlide: Pick<ReturnType<typeof createRailSlide>, "set">, frame: Pick<ShelfFrame, "open" | "fold" | "toggle">, source: Accessor<ActivationSource>, project: Accessor<string | null>) => {
  let before: { rail: boolean; bench: boolean; project: string | null } | null = null;

  createEffect(changesOpen, open => {
    if (open) {
      before = { rail: widths.collapsed(), bench: frame.open(), project: project() };

      const { rail } = before;
      const how = source();

      const fold = () => {
        if (!rail) railSlide.set(true, motionOf(how), false);
        frame.fold(how);
      };

      if (!("getAnimations" in Element.prototype)) return void fold();

      // U7610b: a slide starts in the frame after the one that draws the view, so the open's longest task holds one of the two.
      const frameId = requestAnimationFrame(fold);

      return () => cancelAnimationFrame(frameId);
    }

    const kept = before;

    before = null;

    if (!kept) return;

    // A Project switch re-reads the new Project's Rail, which Changes did not fold.
    if (!kept.rail && kept.project === project() && widths.collapsed()) railSlide.set(false, motionOf(source()));

    if (kept.bench && !frame.open()) frame.toggle(source());
  });
};
