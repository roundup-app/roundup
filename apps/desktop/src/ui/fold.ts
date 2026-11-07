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

type Session = { scope: Element };

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
 * One fold helper (U6398a-d): a pointer press on any fold control commits the final layout once and Motion projects the rows below from where they were drawn (M5, M11); arriving rows fade in; leaving ones fade out through their own exit state, which Ark keeps mounted. A key press (`detail` 0) folds at once (M1); reduced motion fades the arriving rows only (M10). A press while a projection runs retargets that projection from where the rows are drawn (U6398b).
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

      seconds = read("--duration-reorder");
      fade = read("--duration-reduced");
      const curve = tokens.getPropertyValue("--easing-out").match(/[\d.]+/g) ?? [];
      ease = [Number(curve[0]), Number(curve[1]), Number(curve[2]), Number(curve[3])];
    });

    /** Resolves once the press's own handler has changed the DOM, before the next paint. */
    const settled = (scope: Element) => new Promise<void>(resolve => {
      const watch = new MutationObserver(() => { watch.disconnect(); queueMicrotask(() => queueMicrotask(() => resolve())); });
      watch.observe(scope, { subtree: true, childList: true, attributes: true });
      setTimeout(() => { watch.disconnect(); resolve(); }, 50);
    });

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

      if (running && !retargeting) for (const row of running.scope.querySelectorAll(`[${tag}]`)) row.removeAttribute(tag);
      const rows = scope.querySelectorAll(movers);

      for (const row of rows) row.setAttribute(tag, "position");
      const session: Session = { scope };
      running = session;
      const known = new Set(scope.querySelectorAll<HTMLElement>(bodies));
      const pressed = control.getBoundingClientRect().top;

      /** The scroll offset follows the pressed row, so the browser's clamp never moves it under the pointer. */
      const hold = () => {
        if (!control.isConnected || scope === doc.body) return;
        const drift = control.getBoundingClientRect().top - pressed;

        if (drift) scope.scrollTop += drift;
      };

      void animateLayout(scope, () => settled(scope).then(hold), { duration: seconds, ease }).then(group => {
        if (!retargeting) for (const body of scope.querySelectorAll<HTMLElement>(bodies)) if (!known.has(body)) animate(body, { opacity: [0, 1] }, { duration: seconds, ease });

        void group.finished.finally(() => {
          if (running !== session) return;
          running = null;

          for (const row of scope.querySelectorAll(`[${tag}]`)) row.removeAttribute(tag);
        });
      });
    };

    doc.addEventListener("click", press, true);

    return () => { doc.removeEventListener("click", press, true); running = null; dispose(); };
  });
}
