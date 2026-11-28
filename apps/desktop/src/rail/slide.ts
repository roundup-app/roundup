import { createEffect, createSignal, type Accessor } from "solid-js";
import { createSlideLifetime } from "../ui/slideLifetime";
import type { Widths } from "../resize/widths";
import type { ActivationSource } from "../keys/registry";
import type { ShelfFrame } from "../shelf/frame";
import { railAtStart, railSliding, setRailAtStart, setRailSliding } from "./sliding";

/** U6228g: how the Rail's section reads while it folds or opens: the strip shows through a slide, and an opening Rail is drawn as a peek over the centre until the column widens. */
export const railView = (widths: Widths | undefined, peeking: boolean | undefined) => {
  const collapsed = widths?.collapsed() === true;
  // A fold cancelled mid-slide has `collapsed` false while the column is not yet a strip: it still draws as a peek, so it reverses from where it is.
  const laidOut = widths?.laidOut() === true || railSliding() || railAtStart();

  return { strip: collapsed || laidOut, peek: peeking === true || (laidOut && !collapsed) };
};

/** U6228g: folds and opens the Rail by sliding it over the centre, which keeps its width until the slide ends (a Changes fold takes it at the click); a key slides in the key duration, and reduced motion fades. */
export const createRailSlide = (widths: Widths, reducedMotion: Accessor<boolean>) => {
  const lifetime = createSlideLifetime(() => [document.querySelector<HTMLElement>(".rail-body") ?? undefined]);
  const [motion, setMotion] = createSignal<"click" | "key" | "fold" | "fade">();

  createEffect(lifetime.sliding, sliding => { setRailSliding(sliding); });
  createEffect(lifetime.sliding, sliding => {
    if (sliding) return;
    setRailAtStart(false);
    widths.settleLayout();
    setMotion(undefined);
  });

  return {
    motion,
    animatable: lifetime.animatable,
    /** `atStart` (U8075, a Changes fold) gives the column its final width at once and slides only the body over the centre. */
    set: (collapsed: boolean, source: "click" | "key", remember = true, atStart = false) => {
      // Without animations (a test DOM) the change is instant and settles at once.
      const animated = lifetime.animatable();

      setMotion(reducedMotion() ? "fade" : atStart && source === "click" ? "fold" : source);
      setRailAtStart(animated && atStart);
      widths.setCollapsed(collapsed, animated && !atStart, remember);

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
export const createChangesFold = (changesOpen: Accessor<boolean>, widths: Pick<Widths, "collapsed">, railSlide: Pick<ReturnType<typeof createRailSlide>, "set" | "snap" | "animatable">, frame: Pick<ShelfFrame, "open" | "fold" | "unfold">, source: Accessor<ActivationSource>, project: Accessor<string | null>) => {
  const folds = new Map<string | null, Fold>();
  let at: string | null | undefined;
  let was = false;

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

    if (!rail) railSlide.set(true, motionOf(how), false, true);
    frame.fold(how);

    // Recorded once both folds have landed, so the effect they re-run reads no half-made fold as a hand change.
    folds.set(at_, { rail: !rail, bench });
  };

  const restore = (kept: Fold, rail: boolean, bench: boolean) => {
    if (kept.rail && rail) railSlide.set(false, motionOf(source()), true, true);

    if (kept.bench && !bench) frame.unfold(source());
  };

  createEffect(() => [project(), changesOpen(), widths.collapsed(), frame.open()] as const, ([at_, open, rail, bench]) => {
    const switched = at_ !== at;
    const edge = open !== was;
    const kept = folds.get(at_);

    at = at_;
    was = open;

    if (switched) {
      if (open && kept) reshow(kept, rail);

      return;
    }

    if (!edge) {
      if (kept) disown(kept, rail, bench);

      return;
    }

    if (open) return open_(at_, rail, bench);

    folds.delete(at_);

    if (kept) restore(kept, rail, bench);
  });
};
