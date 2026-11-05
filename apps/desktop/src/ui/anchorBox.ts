/**
 * U6236c: the one reader of a floating surface's anchor box. A browser gives an element outside the document, or one that renders no box, `DOMRect(0, 0, 0, 0)`, which sends the surface to the window's top-left. This returns no box for those, so Ark falls back to the trigger it finds by id.
 * `replacement` finds the live element when the captured one was replaced by a re-render.
 */
export const anchorBox = (element: HTMLElement | null | undefined, replacement?: () => HTMLElement | null | undefined): DOMRect | null => {
  const live = (candidate: HTMLElement | null | undefined) => candidate?.isConnected && candidate.checkVisibility?.() !== false ? candidate : null;
  const found = live(element) ?? (replacement ? live(replacement()) : null);

  return found?.getBoundingClientRect() ?? null;
};
