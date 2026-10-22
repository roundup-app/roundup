import type { MenuItem } from "../app/seam";

/** The last system menu a test seam showed, and how to answer it; every test seam writes it. */
type Probe = { shown: MenuItem[] | null; answer: ((id: string | null) => void) | null; count: number };

export const menuProbe: Probe = { shown: null, answer: null, count: 0 };

/** A test seam's `showContextMenu`: records the menu and waits for `answer`. */
export const probeMenu = (items: MenuItem[]): Promise<string | null> => new Promise((resolve) => {
  menuProbe.shown = items;
  menuProbe.count += 1;
  menuProbe.answer = resolve;
});
