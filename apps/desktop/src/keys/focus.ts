import { onCleanup } from "solid-js";

/** Appearance focus belongs to its requesting action, never to a later reply or mount.
 * Focus choices invalidate it permanently, including a trip away and back to the same element.
 * `choose` invalidates older requests before an asynchronous destination has an element to focus.
 */
const revisions = new WeakMap<Document, { value: number; pending: Map<AbortController, ((target: EventTarget | null) => boolean) | undefined>; moving: boolean; native: HTMLElement | null }>();

export const captureFocus = (choose = false): ((move: () => void) => boolean) & { signal: (contains?: (target: EventTarget | null) => boolean) => AbortSignal; target: (destination: () => HTMLElement | null | undefined) => HTMLElement } => {
  let revision = revisions.get(document);

  if (!revision) {
    revision = { value: 0, pending: new Map(), moving: false, native: null };
    revisions.set(document, revision);
    const current = revision;

    const invalidate = (event: Event) => {
      if (event.type === "focusin" && (current.moving || current.native === event.target)) {
        current.native = null;

        return;
      }

      current.native = null;
      current.value++;

      for (const [pending, contains] of current.pending) {
        if (contains?.(event.target)) continue;
        current.pending.delete(pending);
        pending.abort();
      }
    };

    document.addEventListener("focusin", invalidate, true);
    document.addEventListener("pointerdown", invalidate, true);
  }

  if (choose) {
    revision.native = null;
    revision.value++;

    for (const pending of revision.pending.keys()) { revision.pending.delete(pending); pending.abort(); }
  }

  const captured = revision.value;
  let used = false;
  let cancellation: AbortController | undefined;

  const focus = (move: () => void): boolean => {
    if (used) return false;
    used = true;

    if (cancellation) revision.pending.delete(cancellation);

    if (revision.value !== captured) return false;
    const previous = revision.moving;
    revision.moving = true;

    try { move(); } finally { revision.moving = previous; }

    return true;
  };

  // Library focus callbacks cannot all be cancelled directly. Their owner can dismiss the stale
  // appearance through its normal library control before that callback finds a connected input.
  return Object.assign(focus, {
    target: (destination: () => HTMLElement | null | undefined) => {
      let target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      focus(() => {
        target = destination() ?? target;

        if (target !== document.activeElement) {
          revision.native = target;
          queueMicrotask(() => { if (revision.native === target) revision.native = null; });
        }
      });

      return target;
    },
    signal: (contains?: (target: EventTarget | null) => boolean) => {
      if (!cancellation) {
        cancellation = new AbortController();

        if (!used) {
          if (revision.value !== captured) cancellation.abort();
          else revision.pending.set(cancellation, contains);
        }
      }

      return cancellation.signal;
    },
  });
};

/** Elements a component hands to others by name; a caller never finds them by CSS class. */
export type FocusTarget = "terminal.new" | "pane.terminal" | "thread.composer" | "ask.input" | "shelf.tabs" | "shelf.first";

type Provided = HTMLElement | (() => HTMLElement | null | undefined);

const providers = new Map<FocusTarget, () => HTMLElement | null | undefined>();

/** The owner provides `name` until its scope ends. A getter suits an element its library creates later. The last provider wins, and an older cleanup never removes a newer one. */
export const provideFocusTarget = (name: FocusTarget, element: Provided): void => {
  const resolve = element instanceof HTMLElement ? () => element : element;

  providers.set(name, resolve);
  onCleanup(() => { if (providers.get(name) === resolve) providers.delete(name); });
};

/** The provided element, or `undefined` when nothing provides `name` or its element left the page: the caller keeps its fallback. */
export const focusTarget = (name: FocusTarget): HTMLElement | undefined => {
  const element = providers.get(name)?.();

  return element?.isConnected ? element : undefined;
};

/** The one definition of "a layer is open": a Drawer, dialog, alert dialog or menu. A drag in flight counts when `withDrag`. */
const OPEN_LAYER = '.drawer[data-open="true"], [role=dialog], [role=alertdialog], [role=menu]';

export const layerOpen = (withDrag = false): boolean => document.querySelector(withDrag ? `${OPEN_LAYER}, [data-dnd-dragging]` : OPEN_LAYER) !== null;

/** A mount/return callback keeps the permission it had when queued. */
export const queueFocus = (move: () => void): void => {
  const focus = captureFocus();

  queueMicrotask(() => focus(move));
};

/** Return focus to `element`, the one a surface took it from, unless the user has chosen another focus first or it left the page. */
export const returnFocus = (element: Element | null): void => queueFocus(() => { if (element instanceof HTMLElement && element.isConnected) element.focus({ preventScroll: true }); });

/** The innermost item region owns history; an unscoped destination has only explicitly handed-off work. */
export const historyRegion = (focus: Element | null): string => {
  const region = focus?.closest<HTMLElement>("[data-history-region]")
    ?? focus?.closest(".drawer")?.querySelector<HTMLElement>("[data-history-region]");

  return region?.dataset.historyRegion ?? "";
};

/** A Drawer's deletion closes onto the deleted item's own Shelf row when the deletion event has not yet dropped it. Call right after closing: once `refresh` drops that row, focus that is lost goes to the region's first `row`, else the region, unless the user moved it first. */
export const keepRegionFocus = async (refresh: () => Promise<void>, row: string) => {
  const region = document.activeElement?.closest<HTMLElement>("[data-history-region]");
  const survivor = captureFocus();
  await refresh();

  survivor(() => {
    if ((document.activeElement && document.activeElement !== document.body) || !region?.isConnected) return;
    const first = region.querySelector<HTMLElement>(row);

    if (!first && !region.hasAttribute("tabindex")) region.tabIndex = -1;
    (first ?? region).focus({ preventScroll: true });
  });
};
