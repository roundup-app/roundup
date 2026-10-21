import type { ActivationSource } from "../keys/registry";
import { createComputed, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import * as v from "valibot";
import { copy } from "../copy";
import { storedValue } from "../state/storage";
import { createSlideLifetime } from "../ui/slideLifetime";

export const SHELF_TABS = [
  { value: "todos", label: copy.todos, icon: "check" },
  { value: "pads", label: copy.pads, icon: "order" },
] as const;

export type ShelfTab = (typeof SHELF_TABS)[number]["value"];

const frameSchema = v.object({
  maximised: v.optional(v.boolean(), false),
  open: v.optional(v.boolean(), true),
  tab: v.fallback(v.picklist(SHELF_TABS.map(tab => tab.value)), "todos"),
});

/** U373, U370: what the webview keeps per Project, as U100 keeps layout; a stored tab that is neither tab means `todos`, a missing state means open. */
const storageOf = (path: string) => storedValue(`roundup:shelf:${path}`, frameSchema);

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
  /** The slide ended; a closed Shelf leaves the layout. */
  settle: () => void;
};

/** U370, U373: the Shelf's open state and open tab for the active Project, restored in the frame the Project first shows. */
export const createShelfFrame = (path: Accessor<string | null>, reducedMotion: Accessor<boolean>, reflow: () => void): ShelfFrame => {
  const [maximised, setMaximised] = createSignal(false);
  const [open, setOpen] = createSignal(true);
  const lifetime = createSlideLifetime();
  const [shown, setShown] = createSignal(true);
  const [animated, setAnimated] = createSignal(false);
  const [tab, setTabSignal] = createSignal<ShelfTab>("todos");

  const save = () => {
    const at = path();

    if (at !== null) storageOf(at).write({ open: open(), tab: tab(), maximised: maximised() });
  };

  createComputed(
    on(path, (at) => {
      const stored = at === null ? null : storageOf(at).read();
      const restored = stored?.open ?? true;

      setMaximised(stored?.maximised ?? false);
      setAnimated(false);
      lifetime.settle();
      setOpen(restored);
      setShown(restored);
      setTabSignal(stored?.tab ?? "todos");
    }),
  );

  const toggle = (source: ActivationSource = "pointer") => {
    const next = !open();
    const slides = source !== "key" && !reducedMotion();

    setAnimated(slides);
    setOpen(next);
    save();
    lifetime.retarget(next, slides);

    if (!next) {
      setShown(false);

      return;
    }

    if (slides) reflow();

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
    settle: lifetime.settle,
  };
};
