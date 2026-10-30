import type { ActivationSource } from "../keys/registry";
import { batch, createComputed, createEffect, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import { copy } from "../copy";
import { storageSchema, storedValue } from "../state/storage";
import { createSlideLifetime } from "../ui/slideLifetime";

/** U4708: the PADS tab and each Pad row draw this one icon. */
export const PAD_ICON = "sticky-note";

export const SHELF_TABS = [
  { value: "todos", label: copy.todos, icon: "check" },
  { value: "pads", label: copy.pads, icon: PAD_ICON },
] as const;

export type ShelfTab = (typeof SHELF_TABS)[number]["value"];

const frameSchema = storageSchema("roundup:shelf", v.object({
  maximised: v.optional(v.boolean(), true),
  open: v.optional(v.boolean()),
  tab: v.optional(v.fallback(v.picklist(SHELF_TABS.map(tab => tab.value)), "todos")),
}));

/** U373, U370: what the webview keeps per Project, as U100 keeps layout; a stored tab that is neither tab means `todos`, a missing state means open; a surface with no stored size starts as `maximisedByDefault` says (U4698a). */
const storageOf = (path: string, surface: string) => storedValue(surface === "shelf" ? `roundup:shelf:${path}` : `roundup:shelf:${path}:${surface}`, frameSchema);

export type ShelfFrame = {
  /** Whether the user has the Shelf open. */
  open: Accessor<boolean>;
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

/** U370, U373: the Shelf's open state and open tab for the active Project, restored in the frame the Project first shows. */
export const createShelfFrame = (path: Accessor<string | null>, reducedMotion: Accessor<boolean>, reflow: (() => void) | undefined, initialOpen = true, surface: Accessor<string> = () => "shelf", maximisedByDefault: (surface: string) => boolean = () => false): ShelfFrame => {
  const [maximised, setMaximised] = createSignal(false);
  const [open, setOpen] = createSignal(initialOpen);
  const [element, setElement] = createSignal<HTMLElement>();
  const lifetime = createSlideLifetime(() => [element()]);
  const [shown, setShown] = createSignal(initialOpen);
  const [animated, setAnimated] = createSignal(false);
  const [tab, setTabSignal] = createSignal<ShelfTab>("todos");

  const memory = new Map<string, { maximised: boolean; open?: boolean; tab?: ShelfTab }>();

  const save = () => {
    const at = path();

    if (at !== null) {
      const value = surface() === "shelf"
        ? { open: open(), tab: tab(), maximised: maximised() }
        : { maximised: maximised() };

      memory.set(JSON.stringify([at, surface()]), value);
      void storageOf(at, surface()).write(value);
    }
  };

  createComputed(
    on(() => [path(), surface()] as const, ([at, side]) => {
      const stored = at === null ? null : memory.get(JSON.stringify([at, side])) ?? storageOf(at, side).read();
      const restored = stored === null || stored === undefined ? initialOpen : stored.open ?? true;

      setMaximised(stored?.maximised ?? maximisedByDefault(side));
      setAnimated(false);
      lifetime.settle();
      setOpen(restored);
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

  const toggle = (source: ActivationSource = "pointer") => {
    const next = !open();
    const slides = source !== "key" && !reducedMotion();

    // One update: `rendered` must never read false between the open flag and the exit retention changing.
    batch(() => {
      setAnimated(slides);
      setOpen(next);
      lifetime.retarget(next, slides);
    });
    save();

    if (!next) {
      setShown(false);

      return;
    }

    if (slides) reflow?.();

    setShown(true);
  };

  return {
    open,
    maximised,
    toggleMaximise: (source = "pointer") => {
      setAnimated(source !== "key" && !reducedMotion());
      setMaximised(value => !value);
      save();
    },
    rendered: () => open() || lifetime.exiting(),
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
