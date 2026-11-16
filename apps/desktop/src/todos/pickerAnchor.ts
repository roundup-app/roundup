import { untrack } from "solid-js";
import { anchorBox } from "../ui/anchorBox";

/** U6236c: the box a row picker sits against, read when the menu measures it: the row's live box, else the box of the element it was opened from. `replacement` finds the row a re-render replaced. */
export const pickerAnchor = (source: { target: () => { anchor: HTMLElement } | null; replacement?: (() => HTMLElement | null | undefined) | undefined }) => ({
  getBoundingClientRect: () => untrack(() => anchorBox(source.target()?.anchor, source.replacement) ?? source.target()?.anchor.getBoundingClientRect() ?? new DOMRect()),
});
