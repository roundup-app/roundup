import { animate as motionAnimate, animateLayout as motionLayout } from "motion";
import { createRoot, createEffect } from "solid-js";
import type { Accessor } from "solid-js";

/** Every fold control in the App: Ark's tree branch and collapsible triggers, and the Rail's chevrons and section heads. */
const folds = '[data-scope="tree-view"][data-part="branch-control"], [data-scope="tree-view"][data-part="branch-trigger"], [data-scope="collapsible"][data-part="trigger"], .rail-chevron, .rail-group-chevron, .section-head, [data-fold]';

/** What slides when a fold changes the layout above it; nesting is handled by the projection tree. */
const movers = '[role="treeitem"], [data-part="item"], [data-part="branch-control"], .rail-row, .todo-row';

/** What arrives through opacity. */
const bodies = '[data-scope="tree-view"][data-part="branch-content"], [data-scope="collapsible"][data-part="content"], .todo-group-content';

const tag = "data-layout";

/** Set on the scope for a pointer fold's projection; the chevron turns by CSS only under it, so a key fold or a data change snaps (M1). */
const turning = "data-fold-motion";

type Session = { scope: Element };

type Leaving = { body: HTMLElement; parent: Element; next: Node | null; rect: DOMRect };

/** The slice of `motion` the folds use; tests pass a counting double. */
export type FoldEngine = {
  animate: (element: Element, keyframes: Record<string, string[] | number[]>, options: { duration: number; ease?: Ease }) => void;
  animateLayout: (scope: Element, update: () => Promise<void>, options: { duration: number; ease: Ease }) => Promise<{ finished: Promise<void> }>;
};

type Ease = [number, number, number, number];

const motion: FoldEngine = {
  animate: (element, keyframes, options) => { motionAnimate(element, keyframes, options); },
  animateLayout: async (scope, update, options) => {
    const group = await motionLayout(scope, update, options);

    return { finished: Promise.resolve(group).then(() => undefined) };
  },
};

const scrollRegion = (from: Element): Element => {
  for (let at = from.parentElement; at; at = at.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight) return at;
  }

  return from.closest('[role="tree"], section') ?? from.ownerDocument.body;
};

/**
 * One fold helper (U6398a-d): a pointer press on any fold control commits the final layout once and Motion projects the rows below from where they were drawn (M5, M11); arriving rows fade in and unmounted ones fade out. A key press (`detail` 0) folds at once (M1); reduced motion fades the arriving rows only (M10). A press while a projection runs retargets that projection from where the rows are drawn (U6398b).
 */
export function foldMotion(doc: Document, reduced: Accessor<boolean>, { animate, animateLayout }: FoldEngine = motion): () => void {
  return createRoot(dispose => {
    let seconds = 0;
    let fade = 0;
    let ease: Ease = [0, 0, 0, 0];
    let running: Session | null = null;

    createEffect(() => {
      reduced();
      const tokens = getComputedStyle(doc.documentElement);

      const read = (name: string) => {
        const value = tokens.getPropertyValue(name).trim();

        return parseFloat(value) / (value.endsWith("ms") ? 1000 : 1);
      };

      seconds = read("--duration-layout");
      fade = read("--duration-reduced");
      const curve = tokens.getPropertyValue("--easing-out").match(/[\d.]+/g) ?? [];
      ease = [Number(curve[0]), Number(curve[1]), Number(curve[2]), Number(curve[3])];
    });

    /** Resolves once the press's own handler has changed the DOM, before the next paint: true when it changed something, false when nothing did. */
    const settled = (scope: Element) => new Promise<boolean>(resolve => {
      const watch = new MutationObserver(() => { watch.disconnect(); queueMicrotask(() => queueMicrotask(() => resolve(true))); });
      watch.observe(scope, { subtree: true, childList: true, attributes: true });
      setTimeout(() => { watch.disconnect(); resolve(false); }, 50);
    });

    const clear = (scope: Element) => {
      scope.removeAttribute(turning);

      for (const row of scope.querySelectorAll(`[${tag}]`)) row.removeAttribute(tag);
    };

    /** A body the fold unmounted, or hid, is shown again where it was, out of flow and inert, and fades out through opacity; the rows below have already been projected past it. */
    const leave = (body: HTMLElement, parent: Element, next: Node | null, rect: DOMRect) => {
      const unmounted = !body.isConnected;

      if (unmounted ? !parent.isConnected : !body.hidden) return;
      const inert = body.hasAttribute("inert");
      const aria = body.getAttribute("aria-hidden");
      const placed = { position: "fixed", top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none" };
      body.setAttribute("inert", "");
      body.setAttribute("aria-hidden", "true");
      Object.assign(body.style, placed);

      if (unmounted) parent.insertBefore(body, next?.parentNode === parent ? next : null);
      else body.hidden = false;
      animate(body, { opacity: [1, 0] }, { duration: seconds, ease });

      setTimeout(() => {
        if (unmounted) return body.remove();
        Object.assign(body.style, Object.fromEntries([...Object.keys(placed), "opacity"].map(name => [name, ""])));

        if (!inert) body.removeAttribute("inert");

        if (aria === null) body.removeAttribute("aria-hidden");
        else body.setAttribute("aria-hidden", aria);

        body.hidden = body.dataset.state !== "open";
      }, seconds * 1000);
    };

    const press = (event: MouseEvent) => {
      if (event.detail === 0 || event.button !== 0) return;

      const origin = event.composedPath()[0];
      const control = origin instanceof Element ? origin.closest(folds) : null;

      if (!control || control.closest(':disabled, [aria-disabled="true"]')) return;
      const scope = scrollRegion(control);

      if (reduced()) {
        void settled(scope).then(() => {
          for (const body of scope.querySelectorAll<HTMLElement>(bodies)) if (body.dataset.state === "open") animate(body, { opacity: [0, 1] }, { duration: fade });
        });

        return;
      }

      const retargeting = running?.scope === scope;

      if (running && !retargeting) clear(running.scope);
      scope.setAttribute(turning, "");

      for (const row of scope.querySelectorAll(movers)) row.setAttribute(tag, "position");
      const session: Session = { scope };
      running = session;
      const known = new Set(scope.querySelectorAll<HTMLElement>(bodies));
      const before: Leaving[] = [...known].flatMap(body => body.parentElement ? [{ body, parent: body.parentElement, next: body.nextSibling, rect: body.getBoundingClientRect() }] : []);
      const pressed = control.getBoundingClientRect().top;

      /** The scroll offset follows the pressed row, so the browser's clamp never moves it under the pointer. */
      const hold = () => {
        if (!control.isConnected || scope === doc.body) return;
        const drift = control.getBoundingClientRect().top - pressed;

        if (drift) scope.scrollTop += drift;
      };

      let changed = false;

      void animateLayout(scope, () => settled(scope).then(did => { changed = did; if (did) hold(); }), { duration: seconds, ease }).then(group => {
        if (!changed) {
          if (running === session) { running = null; clear(scope); }

          return;
        }

        if (!retargeting) for (const body of scope.querySelectorAll<HTMLElement>(bodies)) if (!known.has(body)) animate(body, { opacity: [0, 1] }, { duration: seconds, ease });

        for (const { body, parent, next, rect } of before) {
          if (body.isConnected && !body.hidden && body.dataset.state === "closed") {
            // Ark hides a closed branch a frame after its state flips; show it again in the same tick.
            const watch = new MutationObserver(() => { if (body.hidden) { watch.disconnect(); leave(body, parent, next, rect); } });
            watch.observe(body, { attributes: true, attributeFilter: ["hidden"] });
            setTimeout(() => watch.disconnect(), 200);
          } else leave(body, parent, next, rect);
        }

        void group.finished.finally(() => {
          if (running !== session) return;
          running = null;
          clear(scope);
        });
      });
    };

    doc.addEventListener("click", press, true);

    return () => { doc.removeEventListener("click", press, true); running = null; dispose(); };
  });
}
