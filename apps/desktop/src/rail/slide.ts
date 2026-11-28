import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { createSlideLifetime } from "../ui/slideLifetime";
import type { Widths } from "../resize/widths";
import type { ActivationSource } from "../keys/registry";
import type { ShelfFrame } from "../shelf/frame";
import { railSliding, setFoldPending, setRailSliding } from "./sliding";

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
    animatable: lifetime.animatable,
    set: (collapsed: boolean, source: "click" | "key", remember = true) => {
      // Without animations (a test DOM) the change is instant and settles at once.
      const animated = lifetime.animatable();

      setMotion(reducedMotion() ? "fade" : source);
      widths.setCollapsed(collapsed, animated, remember);

      if (animated) queueMicrotask(() => lifetime.retarget(!collapsed, true));
      else lifetime.settle();
    },
    /** U8074: shows a Project's fold at once, unsaved, with no slide. */
    snap: (collapsed: boolean) => {
      widths.setCollapsed(collapsed, false, false);
      setMotion(undefined);
      lifetime.settle();
    },
  };
};

const motionOf = (source: ActivationSource) => source === "key" ? "key" : "click";

/** U8074: what Changes folded in a Project, so a Project switch reads it and slides nothing. */
type Fold = { rail: boolean; bench: boolean };

/** U8005a, U8074: Changes folds the Rail and closes the Bench without saving; closing it restores each one the user has not touched since. Only the user's open or close of Changes in the Project on screen slides. */
export const createChangesFold = (changesOpen: Accessor<boolean>, widths: Pick<Widths, "collapsed">, railSlide: Pick<ReturnType<typeof createRailSlide>, "set" | "snap" | "animatable">, frame: Pick<ShelfFrame, "open" | "fold" | "toggle">, source: Accessor<ActivationSource>, project: Accessor<string | null>) => {
  const folds = new Map<string | null, Fold>();
  let at: string | null | undefined;
  let was = false;
  let frameId: number | undefined;

  const cancel = () => {
    if (frameId === undefined) return;

    cancelAnimationFrame(frameId);
    frameId = undefined;
    setFoldPending(false);
  };

  onCleanup(cancel);

  const reshow = (kept: Fold, rail: boolean) => {
    // The new Project's sidebars are read from what the user saved; show the fold Changes made here again, at once.
    if (rail) kept.rail = false;
    else if (kept.rail) railSlide.snap(true);

    if (kept.bench) frame.fold("pointer", false);
  };

  const disown = (kept: Fold, rail: boolean, bench: boolean) => {
    // A sidebar the user changed by hand since the fold is theirs.
    if (!rail) kept.rail = false;

    if (bench) kept.bench = false;
  };

  const open_ = (at_: string | null, rail: boolean, bench: boolean) => {
    const how = source();

    const fold = () => {
      if (!rail) railSlide.set(true, motionOf(how), false);
      frame.fold(how);

      // Recorded once both folds have landed, so the effect they re-run reads no half-made fold as a hand change.
      folds.set(at_, { rail: !rail, bench });
    };

    if (!railSlide.animatable()) return void fold();

    // U7610b: a slide starts in the frame after the one that draws the view, so the open's longest task holds one of the two.
    setFoldPending(true);

    frameId = requestAnimationFrame(() => {
      frameId = undefined;
      fold();
      setFoldPending(false);
    });
  };

  const restore = (kept: Fold, rail: boolean, bench: boolean) => {
    if (kept.rail && rail) railSlide.set(false, motionOf(source()));

    if (kept.bench && !bench) frame.toggle(source());
  };

  createEffect(() => [project(), changesOpen(), widths.collapsed(), frame.open()] as const, ([at_, open, rail, bench]) => {
    const switched = at_ !== at;
    const edge = open !== was;
    const kept = folds.get(at_);

    at = at_;
    was = open;

    if (switched) {
      cancel();

      if (open && kept) reshow(kept, rail);

      return;
    }

    if (!edge) {
      if (kept) disown(kept, rail, bench);

      return;
    }

    if (open) return open_(at_, rail, bench);

    cancel();
    folds.delete(at_);

    if (kept) restore(kept, rail, bench);
  });
};
