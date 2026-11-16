import { copy } from "./copy";
import { createSignal, untrack, type Accessor } from "solid-js";
import { saveViewer, viewer, type Viewer } from "./viewer";

type Limits = { min: number; max: number; fallback: number };

/** U389, U390: each width's minimum, maximum and default in px; tokens.css holds the same two defaults. */
const RAIL: Limits = { min: 252, max: 480, fallback: 288 };

/** U6228: the collapsed Rail's width in px; tokens.css holds the same value as `--rail-strip-width`. */
export const STRIP_WIDTH = 56;

const SHELF: Limits = { min: 240, max: 560, fallback: 320 };

const limited = (px: number, limits: Limits): number => Math.min(limits.max, Math.max(limits.min, px));

/** U453: supported windows leave room for the Rail's full resize range. */
export const railEffective = (stored: number): number => limited(stored, RAIL);

/** U453: supported windows leave room for the Shelf's full resize range. */
export const shelfEffective = (stored: number): number => limited(stored, SHELF);

/** One width's handle for its Resize edge. `direction` is the sign a pointer moving right changes the width by. */
export type Side = {
  label: string;
  direction: 1 | -1;
  min: number;
  fallback: number;
  /** The rendered width in px. */
  now: Accessor<number>;
  /** The user resize maximum. */
  room: Accessor<number>;
  /** Shows a width while it is dragged: a style write, no state. */
  preview: (px: number) => void;
  /** Keeps a width. */
  commit: (px: number) => void;
  /** U6228: the width at which this side is collapsed to a strip; a drag, key or reset reaching it collapses, a larger width expands. */
  collapsedAt?: number;
};

export type Widths = {
  rail: Side;
  /** U6228: whether the Rail is the strip of Workstream marks. */
  collapsed: Accessor<boolean>;
  /** U6228g: the Rail's column is a strip. It follows `collapsed` at once, or after a slide when `setCollapsed` kept it. */
  laidOut: Accessor<boolean>;
  /** U6228: collapse or expand the Rail, keeping its last width for the expand. With `slide`, the column keeps its width until `settleLayout`, so the centre changes once (U6228g). */
  setCollapsed: (collapsed: boolean, slide?: boolean) => void;
  /** U6228g: the slide is over; the column takes the collapsed state's width. */
  settleLayout: () => void;
  shelf: Side;
  /** The two widths in px as CSS values, for the window's style. */
  style: () => Record<string, string>;
  /** The window element the preview writes into. */
  attach: (element: HTMLElement) => void;
};

/** U389, U390: the Rail's and Shelf's widths, one record for every Project, so a Project switch changes none of them. */
export const createWidths = (path: Accessor<string | null>): Widths => {
  // Read on each Project switch only: a saved change does not reset the widths the user is dragging.
  const stored = (): Viewer | null => path() === null ? null : untrack(viewer);

  const [rail, setRail] = createSignal(() => stored()?.rail ?? RAIL.fallback);

  const [shelf, setShelf] = createSignal(() => stored()?.shelf ?? SHELF.fallback);

  const [collapsed, setCollapsedSignal] = createSignal(() => stored()?.collapsed ?? false);

  const [laidOut, setLaidOut] = createSignal(() => stored()?.collapsed ?? false);

  const setBoth = (next: boolean) => { setCollapsedSignal(next); setLaidOut(next); };

  let element: HTMLElement | undefined;

  const railNow = () => laidOut() ? STRIP_WIDTH : railEffective(rail());

  const shelfNow = () => shelfEffective(shelf());

  /** `patch` holds what the caller just wrote; its signal reads the old value until the update lands. */
  const save = (patch: Partial<Viewer> = {}) => {
    if (path() !== null) saveViewer({ rail: rail(), shelf: shelf(), collapsed: collapsed(), ...patch });
  };

  const write = (railPx: number, shelfPx: number) => {
    element?.style.setProperty("--rail-width", `${railPx}px`);
    element?.style.setProperty("--shelf-span", `${shelfPx}px`);
  };

  return {
    collapsed,
    laidOut,
    setCollapsed: (next, slide = false) => {
      if (slide) setCollapsedSignal(next);
      else setBoth(next);

      save({ collapsed: next });
    },
    settleLayout: () => setLaidOut(collapsed()),
    rail: {
      label: copy.resizeRail,
      direction: 1,
      min: RAIL.min,
      fallback: RAIL.fallback,
      now: railNow,
      room: () => RAIL.max,
      collapsedAt: STRIP_WIDTH,
      preview: (px) => write(px <= STRIP_WIDTH ? STRIP_WIDTH : railEffective(px), shelfEffective(shelf())),
      commit: (px) => {
        if (px <= STRIP_WIDTH) {
          setBoth(true);
          save({ collapsed: true });
        } else {
          const width = limited(px, RAIL);

          setBoth(false);
          setRail(width);
          save({ collapsed: false, rail: width });
        }
      },
    },
    shelf: {
      label: copy.resizeShelf,
      direction: -1,
      min: SHELF.min,
      fallback: SHELF.fallback,
      now: shelfNow,
      room: () => SHELF.max,
      preview: (px) => write(railNow(), shelfEffective(px)),
      commit: (px) => {
        const width = limited(px, SHELF);

        setShelf(width);
        save({ shelf: width });
      },
    },
    style: () => ({ "--rail-width": `${railNow()}px`, "--rail-peek-width": `${railEffective(rail())}px`, "--shelf-span": `${shelfNow()}px` }),
    attach: (el) => {
      element = el;
    },
  };
};
