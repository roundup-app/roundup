import { createEffect, type Accessor } from "solid-js";
import type { Widths } from "./resize/widths";
import type { createRailSlide } from "./rail/slide";
import type { ShelfFrame } from "./shelf/frame";

/** U8005a: Changes folds the Rail and closes the Bench without saving; closing it restores each one the user has not touched since. */
export const createChangesFold = (changesOpen: Accessor<boolean>, widths: Widths, railSlide: ReturnType<typeof createRailSlide>, frame: ShelfFrame) => {
  let before: { rail: boolean; bench: boolean } | null = null;

  createEffect(changesOpen, open => {
    if (open) {
      before = { rail: widths.collapsed(), bench: frame.open() };

      if (!before.rail) railSlide.set(true, "click", false);
      frame.fold();

      return;
    }

    const kept = before;

    before = null;

    if (!kept) return;

    if (!kept.rail && widths.collapsed()) railSlide.set(false, "click");

    if (kept.bench && !frame.open()) frame.toggle("pointer");
  });
};
