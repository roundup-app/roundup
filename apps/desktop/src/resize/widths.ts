import { copy } from "../copy";
import { createComputed, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import { storedValue } from "../state/storage";

type Limits = { min: number; max: number; fallback: number };

/** U389, U390: each width's minimum, maximum and default in px; tokens.css holds the same two defaults. */
export const RAIL: Limits = { min: 252, max: 480, fallback: 288 };

const SHELF: Limits = { min: 240, max: 560, fallback: 320 };

const limited = (px: number, limits: Limits): number => Math.min(limits.max, Math.max(limits.min, px));

/** U453: supported windows leave room for the Rail's full resize range. */
export const railEffective = (stored: number): number => limited(stored, RAIL);

/** U453: supported windows leave room for the Shelf's full resize range. */
export const shelfEffective = (stored: number): number => limited(stored, SHELF);

const finite = (fallback: number) => v.fallback(v.pipe(v.number(), v.finite()), fallback);

const widthsSchema = v.object({ rail: finite(RAIL.fallback), shelf: finite(SHELF.fallback) });

/** U389, U390: what the webview keeps per Project, as U100 keeps layout; a stored width that is not a finite number means the default. */
const storageOf = (path: string) => storedValue(`roundup:widths:${path}`, widthsSchema);

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
};

export type Widths = {
  rail: Side;
  shelf: Side;
  /** The two widths in px as CSS values, for the window's style. */
  style: () => Record<string, string>;
  /** The window element the preview writes into. */
  attach: (element: HTMLElement) => void;
};

/** U389, U390: the Rail's and Shelf's widths for the active Project, restored in the frame the Project first shows. */
export const createWidths = (path: Accessor<string | null>): Widths => {
  const [rail, setRail] = createSignal(RAIL.fallback);

  const [shelf, setShelf] = createSignal(SHELF.fallback);

  let element: HTMLElement | undefined;

  createComputed(
    on(path, (at) => {
      const stored = at === null ? null : storageOf(at).read();

      setRail(stored?.rail ?? RAIL.fallback);
      setShelf(stored?.shelf ?? SHELF.fallback);
    }),
  );

  const railNow = () => railEffective(rail());

  const shelfNow = () => shelfEffective(shelf());

  const save = () => {
    const at = path();

    if (at !== null) storageOf(at).write({ rail: rail(), shelf: shelf() });
  };

  const write = (railPx: number, shelfPx: number) => {
    element?.style.setProperty("--rail-width", `${railPx}px`);
    element?.style.setProperty("--shelf-span", `${shelfPx}px`);
  };

  return {
    rail: {
      label: copy.resizeRail,
      direction: 1,
      min: RAIL.min,
      fallback: RAIL.fallback,
      now: railNow,
      room: () => RAIL.max,
      preview: (px) => {
        const next = railEffective(px);

        write(next, shelfEffective(shelf()));
      },
      commit: (px) => {
        setRail(limited(px, RAIL));
        save();
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
        setShelf(limited(px, SHELF));
        save();
      },
    },
    style: () => ({ "--rail-width": `${railNow()}px`, "--shelf-span": `${shelfNow()}px` }),
    attach: (el) => {
      element = el;
    },
  };
};
