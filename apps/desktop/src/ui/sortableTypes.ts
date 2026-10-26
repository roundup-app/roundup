import type { JSX } from "solid-js";
import type { UseSortableInput } from "@dnd-kit/solid/sortable";

/** A drop target outside the list; `element` carries `data-drop` while the pointer is over it. */
export type ExternalTarget = { element: HTMLElement; /** Carried instead of the list's `attribute` while the pointer is over this target. */ attribute?: string };

export type External<T extends ExternalTarget> = {
  /** The target under the pointer for a dragged row, else null. */
  target: (id: string, x: number, y: number) => T | null;
  onDropOutside: (id: string, target: T) => void;
  /** The attribute the target carries while the pointer is over it; default `data-drop`. */
  attribute?: string;
};

/** A row of the caller's tree, in display order. */
export type TreeRow = { id: string; parent: string | null };

/** Where a drag would land: the parent, the index among that parent's other children, and the depth the drop line sits at. */
export type SortableDrop = { parent: string | null; index: number; depth: number };

/** A committed drop: `index` counts the parent's children without the dragged row. */
export type SortableMove = { id: string; parent: string | null; index: number };

/** Rows with a parent: a drop reports `onMove` instead of the flat order. */
export type SortableTree = {
  rows: readonly TreeRow[];
  /** One level of indentation in pixels: how far right of where the drag began picks the next deeper parent. */
  indent: number;
  nests: (id: string) => boolean;
  onMove: (move: SortableMove) => void;
  /** The drop a release would commit, or null once the drag ends. */
  onPreview: (drop: SortableDrop | null) => void;
};

export type RootProps<T extends ExternalTarget> = Omit<JSX.HTMLAttributes<HTMLDivElement>, "onDrag"> & {
  ids: readonly string[];
  /** The flat order after a drop; not called when `tree` is given. */
  onOrderChange?: ((ids: string[]) => void) | undefined;
  tree?: SortableTree | undefined;
  external?: External<T> | undefined;
  /** The handles are buttons that keep their own meaning: the library adds no live region and no `aria-pressed`, `aria-grabbed`, `aria-disabled`, role description or description to them. */
  plain?: boolean;
  /** Called with true when a drag of one of this list's rows starts and false when it ends. */
  onDrag?: ((active: boolean) => void) | undefined;
};

/** What the drag implementation reads of a list. */
export type RootBinding<T extends ExternalTarget> = Pick<RootProps<T>, "ids" | "onOrderChange" | "tree" | "external" | "plain" | "onDrag"> & { list: () => HTMLDivElement | undefined };

/** What the drag implementation reads of a row, and how it reports back. */
export type ItemBinding = {
  id: () => UseSortableInput["id"];
  index: () => number;
  disabled: () => UseSortableInput["disabled"];
  pressable: boolean | undefined;
  element: () => HTMLElement | undefined;
  handle: () => HTMLElement | undefined;
  setDragging: (dragging: boolean) => void;
};
