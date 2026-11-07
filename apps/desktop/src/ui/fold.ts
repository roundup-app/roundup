import { animate as motionAnimate } from "motion";
import { createRoot, createEffect } from "solid-js";
import type { Accessor } from "solid-js";
import { attachFold } from "./foldProject";
import { translateOf } from "./reorderMotion";

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
  animate: (element: Element, keyframes: Record<string, string[] | number[]>, options: { duration: number; ease?: Ease }) => { cancel: () => void } | void;
  animateLayout: (scope: Element, update: () => Promise<void>, options: { duration: number; ease: Ease }) => Promise<{ finished: Promise<void> }>;
};

type Ease = [number, number, number, number];

/** The animations on a row that run its translate. */
const cancelTranslates = (row: Element) => {
  for (const animation of row.getAnimations()) {
    const translating = animation instanceof CSSTransition ? animation.transitionProperty === "translate" : animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => "translate" in frame);

    if (translating) animation.cancel();
  }
};

/** The rows to slide: the innermost movers, since an outer one carries them with it. */
const drawn = (scope: Element) => [...scope.querySelectorAll<HTMLElement>(movers)].filter(row => !row.closest("[inert], [hidden]") && !row.querySelector(movers));

/**
 * Rows slide by `translate` from where they were drawn to where the change leaves them (M5, M11). A row the sortable shifts slides itself, and the row it holds is the pointer's. A row that was not drawn fades in unless a fading body carries it.
 */
const slide = async (scope: Element, update: () => Promise<void>, { duration, ease }: { duration: number; ease: Ease }) => {
  const first = new Map(drawn(scope).map(row => [row, row.getBoundingClientRect().top]));

  await update();

  const rows = drawn(scope).filter(row => !row.matches("[data-dnd-dragging], [data-dnd-dropping]"));

  // A row slides once, by its real displacement: a translate still running on it would be read into the distance and added to it.
  for (const row of rows) if (!row.style.translate) cancelTranslates(row);
  const tops = rows.map(row => row.getBoundingClientRect().top - translateOf(row).y);
  const options = { duration: duration * 1000, easing: `cubic-bezier(${ease.join(",")})` };
  const running: Animation[] = [];

  rows.forEach((row, at) => {
    const was = first.get(row);

    if (was === undefined) {
      if (!row.closest(bodies)) running.push(row.animate({ opacity: [0, 1] }, options));
    } else if (!row.style.translate && Math.abs(was - tops[at]!) >= 1) running.push(row.animate({ translate: [`0 ${was - tops[at]!}px`, "0 0"] }, options));
  });

  return { finished: Promise.allSettled(running.map(animation => animation.finished)).then(() => undefined) };
};

const motion: FoldEngine = {
  animate: (element, keyframes, options) => motionAnimate(element, keyframes, options),
  animateLayout: slide,
};

const scrollRegion = (from: Element): Element => {
  for (let at = from.parentElement; at; at = at.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(at).overflowY) && at.scrollHeight > at.clientHeight) return at;
  }

  return from.closest('[role="tree"], section') ?? from.ownerDocument.body;
};

/**
 * One fold helper (U6398a-d): a pointer press on any fold control commits the final layout once and the rows below slide by `translate` from where they were drawn (M5, M11); arriving rows fade in and unmounted ones fade out. A key press (`detail` 0) folds at once (M1); reduced motion fades the arriving rows only (M10). A press while a projection runs retargets that projection from where the rows are drawn (U6398b).
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
      const fading = animate(body, { opacity: [1, 0] }, { duration: seconds, ease });

      setTimeout(() => {
        // Drop the animation first: its end would otherwise write opacity 0 after the styles below are cleared.
        fading?.cancel();

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

      start(scope, () => {}, control);
    };

    const start = (scope: Element, change: () => void, control?: Element) => {
      const retargeting = running?.scope === scope;

      if (running && !retargeting) clear(running.scope);
      scope.setAttribute(turning, "");

      for (const row of scope.querySelectorAll(movers)) row.setAttribute(tag, "position");
      const session: Session = { scope };
      running = session;
      const known = new Set(scope.querySelectorAll<HTMLElement>(bodies));
      const before: Leaving[] = [...known].flatMap(body => body.parentElement ? [{ body, parent: body.parentElement, next: body.nextSibling, rect: body.getBoundingClientRect() }] : []);
      const pressed = control?.getBoundingClientRect().top ?? 0;

      /** The scroll offset follows the pressed row, so the browser's clamp never moves it under the pointer. */
      const hold = () => {
        if (!control?.isConnected || scope === doc.body) return;
        const drift = control.getBoundingClientRect().top - pressed;

        if (drift) scope.scrollTop += drift;
      };

      let changed = false;

      void animateLayout(scope, () => {
        const done = settled(scope);

        change();

        return done.then(did => {
          changed = did;

          if (did) hold();
        });
      }, { duration: seconds, ease }).then(group => {
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
    const detach = attachFold((scope, change, anchor) => { if (reduced()) change(); else start(scope, change, anchor); });

    return () => { doc.removeEventListener("click", press, true); detach(); running = null; dispose(); };
  });
}
