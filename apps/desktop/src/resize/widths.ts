import { createComputed, createSignal, on, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import { storedValue } from "../state/storage";

type Limits = { min: number; max: number; fallback: number };

/** U389, U390: each width's minimum, maximum and default in px; tokens.css holds the same two defaults. */
export const RAIL: Limits = { min: 252, max: 480, fallback: 288 };

export const SHELF: Limits = { min: 240, max: 560, fallback: 320 };

/** U389: the centre pane keeps this much of the window (U85's 640 px less the Rail's 252 px). */
export const PANE_MIN = 388;

const limited = (px: number, limits: Limits): number => Math.min(limits.max, Math.max(limits.min, px));

/** The Rail's width at a window width: its stored width, within its limits and the room the pane keeps, never under its minimum. */
export const railEffective = (stored: number, window: number): number => Math.max(RAIL.min, Math.min(limited(stored, RAIL), window - PANE_MIN));

/** The Shelf is an overlay beside the Rail: its width stops where the Rail's begins. */
export const shelfEffective = (stored: number, window: number, rail: number): number => Math.min(limited(stored, SHELF), Math.max(0, window - rail));

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
  /** The largest width that fits now. */
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

  const [window_, setWindow] = createSignal(globalThis.window.innerWidth);
  let element: HTMLElement | undefined;

  const onResize = () => setWindow(globalThis.window.innerWidth);

  globalThis.window.addEventListener("resize", onResize);
  onCleanup(() => globalThis.window.removeEventListener("resize", onResize));

  createComputed(
    on(path, (at) => {
      const stored = at === null ? null : storageOf(at).read();

      setRail(stored?.rail ?? RAIL.fallback);
      setShelf(stored?.shelf ?? SHELF.fallback);
    }),
  );

  const railNow = () => railEffective(rail(), window_());

  const shelfNow = () => shelfEffective(shelf(), window_(), railNow());

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
      label: "resize Rail",
      direction: 1,
      min: RAIL.min,
      fallback: RAIL.fallback,
      now: railNow,
      room: () => railEffective(RAIL.max, window_()),
      preview: (px) => {
        const next = railEffective(px, window_());

        write(next, shelfEffective(shelf(), window_(), next));
      },
      commit: (px) => {
        setRail(limited(px, RAIL));
        save();
      },
    },
    shelf: {
      label: "resize Shelf",
      direction: -1,
      min: SHELF.min,
      fallback: SHELF.fallback,
      now: shelfNow,
      room: () => shelfEffective(SHELF.max, window_(), railNow()),
      preview: (px) => write(railNow(), shelfEffective(px, window_(), railNow())),
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
