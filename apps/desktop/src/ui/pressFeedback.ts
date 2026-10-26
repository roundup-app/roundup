import { animate } from "motion";
import { createEffect, createRoot } from "solid-js";
import type { Accessor } from "solid-js";

const releases = new WeakMap<Element, () => void>();

/** Ends feedback before the existing drag owner measures and lifts its source. */
export function clearPress(element: Element): void {
  releases.get(element)?.();
  element.removeAttribute("data-pressed");
}

/** Adds transient feedback only; the platform and Ark retain all activation semantics. */
export function pressFeedback(doc: Document, reduced: Accessor<boolean> = () => false): () => void {
  return createRoot(dispose => {
    const effects = new Map<Element, { animation: ReturnType<typeof animate>; restore: () => void }>();
    let pointerDown = false;
    let seconds = 0;
    let scale = 1;
    let ease: [number, number, number, number] = [0, 0, 0, 0];
    const resolveTokens = () => {
      const tokens = getComputedStyle(doc.documentElement);
      const duration = tokens.getPropertyValue("--duration-press").trim();
      seconds = parseFloat(duration) / (duration.endsWith("ms") ? 1000 : 1);
      scale = Number(tokens.getPropertyValue("--scale-press"));
      const curve = tokens.getPropertyValue("--easing-out").match(/[\d.]+/g) ?? [];
      ease = [Number(curve[0]), Number(curve[1]), Number(curve[2]), Number(curve[3])];
    };
    const stop = () => { effects.forEach((effect, el) => { effect.animation.cancel(); effect.restore(); releases.delete(el); }); effects.clear(); };

    const move = (el: Element, down: boolean) => {
      // Full-width rows keep their tree inset, guides and hairline fixed; shared CSS supplies instant ink feedback.
      if (reduced() || el.matches('[role=treeitem], .rail-row, .todo-row, .todo-row-button')) return;
      if (!(el instanceof HTMLElement) || !("animate" in el)) return;
      const visual = el.matches("input") ? el.closest<HTMLElement>(".app-checkbox, .app-radio, .app-segment") ?? el : el;
      const previous = effects.get(el);
      const computed = getComputedStyle(visual);
      const fromTransform = computed.transform === "none" ? new DOMMatrix().toString() : computed.transform;
      const transform = visual.style.transform;
      const restore = previous?.restore ?? (() => { visual.style.transform = transform; });
      previous?.animation.cancel();
      restore();
      const base = getComputedStyle(visual).transform;
      const target = new DOMMatrix(base === "none" ? undefined : base).scale(down ? scale : 1).toString();
      const animation = animate(visual, { transform: [fromTransform, target] }, { duration: seconds, ease });

      const effect = { animation, restore };
      effects.set(el, effect);
      releases.set(el, () => {
        effect.animation.cancel();
        effect.restore();
        effects.delete(el);
        releases.delete(el);

        if (pressing === el) { pointerDown = false; pressing = null; }
      });
      void animation.then(() => {
        if (effects.get(el) !== effect || down) return;
        animation.cancel(); restore(); effects.delete(el); releases.delete(el);
      });
    };

    let pressing: Element | null = null;

    const clear = () => {
      const el = pressing;

      if (el && pointerDown) move(el, false);
      pressing?.removeAttribute("data-pressed"); pressing = null;
      pointerDown = false;
    };

    createEffect(() => {
      reduced();
      resolveTokens();
      stop();
    });

    const control = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('textarea, [contenteditable=true], .xterm, input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=range])')) return null;
      const el = target.closest('button, a[href], summary, input:is([type=checkbox], [type=radio], [type=button], [type=submit], [type=range]), [role=button], [role=tab], [role=menuitem], [role=option], [role=treeitem]');

      return el?.closest(':disabled, [aria-disabled=true], [data-disabled]') ? null : el;
    };

    const begin = (el: Element | null) => {
      clear();
      pressing = el;
      pressing?.setAttribute("data-pressed", "true");
    };

    const pointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const el = control(event.composedPath()[0] ?? null);
      clear();
      pressing = el;
      pointerDown = el !== null;

      if (el) move(el, true);
      el?.setAttribute("data-pressed", "true");
    };

    const key = (event: KeyboardEvent) => {
      if (pointerDown) return;
      stop();

      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const el = control(event.composedPath()[0] ?? null);

      if (!el) return;
      const space = event.key === " " && !el.matches('a[href], [role=option]');
      const enter = event.key === "Enter" && !el.matches('input:is([type=checkbox],[type=radio],[type=range])');

      if (space || enter) begin(el);
    };

    const leave = (event: PointerEvent) => {
      const target = event.composedPath()[0];

      if (pressing && target instanceof Node && pressing.contains(target) && (!(event.relatedTarget instanceof Node) || !pressing.contains(event.relatedTarget))) clear();
    };

    const view = doc.defaultView!;
    doc.addEventListener("pointerdown", pointer, true);
    doc.addEventListener("pointerout", leave, true);
    doc.addEventListener("keydown", key, true);

    const blur = (event: Event) => {
      const target = event.composedPath()[0];

      if (target === event.currentTarget || (target instanceof Node && pressing?.contains(target))) clear();
    };

    const drag = () => { pointerDown = false; clear(); stop(); };

    view.addEventListener("dragstart", drag, true);
    view.addEventListener("blur", blur, true);
    const keyup = () => { if (!pointerDown) clear(); };
    view.addEventListener("keyup", keyup, true);
    const endings = ["pointerup", "pointercancel", "lostpointercapture"] as const;

    for (const name of endings) view.addEventListener(name, clear, true);

    return () => {
      pointerDown = false; clear(); stop(); dispose();
      view.removeEventListener("keyup", keyup, true);
      view.removeEventListener("dragstart", drag, true);
      view.removeEventListener("blur", blur, true);
      doc.removeEventListener("pointerdown", pointer, true);
      doc.removeEventListener("pointerout", leave, true);
      doc.removeEventListener("keydown", key, true);

      for (const name of endings) view.removeEventListener(name, clear, true);
    };
  });
}
