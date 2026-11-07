import type { ActivationSource } from "../keys/registry";
import { batch, createComputed, createEffect, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import { copy } from "./copy";
import { saveViewer, viewer } from "../resize/viewer";
import { createSlideLifetime } from "../ui/slideLifetime";

/** U4708: the PADS tab and each Pad row draw this one icon. */
export const PAD_ICON = "sticky-note";

export const SHELF_TABS = [
  { value: "todos", label: copy.todos, icon: "check" },
  { value: "pads", label: copy.pads, icon: PAD_ICON },
] as const;

export type ShelfTab = (typeof SHELF_TABS)[number]["value"];

/** U6224: closed, peeking in from the trailing edge without being used, or open. */
type ShelfPhase = "closed" | "peeking" | "open";

export type ShelfFrame = {
  /** Whether the user has the Shelf open; a peek is not open. */
  open: Accessor<boolean>;
  /** U6224: the Shelf covers the centre at the pointer's request and nothing is saved. */
  peeking: Accessor<boolean>;
  /** U6224: a peek is in the layout, sliding in, resting or sliding back; it never reserves width. */
  covering: Accessor<boolean>;
  /** U6224: slide in over the centre without saving anything. */
  peek: () => void;
  /** U6224: slide a peek back without saving anything. */
  unpeek: () => void;
  /** U6224: use turns a peek into the open Shelf, in place and saved. */
  promote: () => void;
  /** Whether its box is in the layout: false once the close has ended (U369). */
  rendered: Accessor<boolean>;
  /** Whether it sits at its open position; one frame behind `open` while it slides in. */
  shown: Accessor<boolean>;
  /** True from the first toggle of a Project; a restored state never animates (U370). */
  animated: Accessor<boolean>;
  maximised: Accessor<boolean>;
  toggleMaximise: (source?: ActivationSource) => void;
  tab: Accessor<ShelfTab>;
  setTab: (tab: ShelfTab) => void;
  toggle: (source?: ActivationSource) => void;
  /** Bind the Shelf whose browser animations retain its content. */
  attach: (element: HTMLElement) => void;
  sliding: Accessor<boolean>;
  /** Release a slide on a Project switch or removal. */
  settle: () => void;
};

/** U370, U373: the Shelf's open state and open tab, one record for every Project, so a Project switch changes none of them. */
export const createShelfFrame = (path: Accessor<string | null>, reducedMotion: Accessor<boolean>, reflow: (() => void) | undefined, initialOpen = true, surface: Accessor<string> = () => "shelf", maximisedByDefault: (surface: string) => boolean = () => false): ShelfFrame => {
  const [maximised, setMaximised] = createSignal(false);
  const [phase, setPhase] = createSignal<ShelfPhase>(initialOpen ? "open" : "closed");
  // A peek keeps covering the centre while it slides back, so the layout does not reserve width for a Shelf that never opened.
  const [covered, setCovered] = createSignal(false);
  const open = () => phase() === "open";
  const peeking = () => phase() === "peeking";
  const [element, setElement] = createSignal<HTMLElement>();
  const lifetime = createSlideLifetime(() => [element()]);
  const [shown, setShown] = createSignal(initialOpen);
  const [animated, setAnimated] = createSignal(false);
  const [tab, setTabSignal] = createSignal<ShelfTab>("todos");

  const save = () => {
    if (path() === null) return;

    if (surface() === "shelf") saveViewer({ frame: { open: open(), tab: tab(), maximised: maximised() } });
    else saveViewer({ surfaces: { ...viewer().surfaces, [surface()]: maximised() } });
  };

  createComputed(
    on(() => [path(), surface()] as const, ([at, side]) => {
      const kept = at === null ? null : viewer();
      const stored = kept === null ? null : side === "shelf" ? kept.frame : kept.surfaces[side] === undefined ? null : { maximised: kept.surfaces[side], open: undefined, tab: undefined };
      const restored = stored === null || stored === undefined ? initialOpen : stored.open ?? true;

      setMaximised(stored?.maximised ?? maximisedByDefault(side));
      setAnimated(false);
      lifetime.settle();
      setPhase(restored ? "open" : "closed");
      setCovered(false);
      setShown(restored);
      setTabSignal(stored?.tab ?? "todos");
    }),
  );

  // U3010b: reduced motion switched on mid-slide settles the latest destination now and replays nothing.
  createEffect(on(reducedMotion, (reduced) => {
    if (!reduced) return;

    setAnimated(false);
    lifetime.settle();
  }, { defer: true }));

  const rendered = () => phase() !== "closed" || lifetime.exiting();

  const move = (to: ShelfPhase, slides: boolean, remember: boolean) => {
    // One update: `rendered` must never read false between the phase and the exit retention changing.
    batch(() => {
      setAnimated(slides);
      setCovered(to === "peeking" || (to === "closed" && covered()));
      setPhase(to);
      lifetime.retarget(to !== "closed", slides);
    });

    if (remember) save();

    if (to === "closed") {
      setShown(false);

      return;
    }

    if (slides) reflow?.();

    setShown(true);
  };

  const toggle = (source: ActivationSource = "pointer") => {
    // U6224: the bar tab, `⌘K B` and the close button turn a peek into the open Shelf where it stands.
    if (peeking()) {
      promote();

      return;
    }

    move(open() ? "closed" : "open", source !== "key" && !reducedMotion(), true);
  };

  const promote = () => {
    if (!peeking()) return;

    batch(() => {
      lifetime.settle();
      setAnimated(false);
      setCovered(false);
      setPhase("open");
    });
    save();
  };

  const peek = () => {
    if (path() === null || phase() !== "closed") return;

    move("peeking", !reducedMotion(), false);
  };

  const unpeek = () => {
    if (!peeking()) return;

    move("closed", !reducedMotion(), false);
  };

  return {
    open,
    peeking,
    covering: () => covered() && rendered(),
    peek,
    unpeek,
    promote,
    maximised,
    toggleMaximise: (source = "pointer") => {
      setAnimated(source !== "key" && !reducedMotion());
      setMaximised(value => !value);
      save();
    },
    rendered,
    shown,
    animated,
    tab,
    setTab: (next) => {
      setTabSignal(next);
      save();
    },
    toggle,
    attach: setElement,
    sliding: lifetime.sliding,
    settle: lifetime.settle,
  };
};
