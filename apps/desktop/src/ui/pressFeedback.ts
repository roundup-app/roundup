import { animate } from "motion";
import { createEffect, createRoot } from "solid-js";
import type { Accessor } from "solid-js";

/** Adds transient feedback only; the platform and Ark retain all activation semantics. */
export function pressFeedback(doc: Document, reduced: Accessor<boolean> = () => false): () => void {
  return createRoot(dispose => {
    const effects = new Map<Element, { animation: ReturnType<typeof animate>; restore: () => void }>();
    let pointerHeld = false;
    const stop = () => { effects.forEach(effect => { effect.animation.cancel(); effect.restore(); }); effects.clear(); };
    const move = (el: Element, down: boolean) => {
      if (!(el instanceof HTMLElement) || !("animate" in el)) return;
      const previous = effects.get(el);
      const computed = getComputedStyle(el);
      const fromTransform = computed.transform === "none" ? new DOMMatrix().toString() : computed.transform;
      const fromOpacity = computed.opacity;
      const transform = el.style.transform;
      const opacity = el.style.opacity;
      const restore = previous?.restore ?? (() => { el.style.transform = transform; el.style.opacity = opacity; });
      previous?.animation.cancel();
      restore();
      const tokens = getComputedStyle(doc.documentElement);
      const duration = tokens.getPropertyValue(reduced() ? "--duration-reduced" : "--duration-press").trim();
      const seconds = parseFloat(duration) / (duration.endsWith("ms") ? 1000 : 1);
      const scale = down ? tokens.getPropertyValue("--scale-press").trim() : "1";
      const base = getComputedStyle(el).transform;
      const target = new DOMMatrix(base === "none" ? undefined : base).scale(Number(scale)).toString();
      const curve = tokens.getPropertyValue("--easing-out").match(/[\d.]+/g) ?? [];
      const ease: [number, number, number, number] = [Number(curve[0]), Number(curve[1]), Number(curve[2]), Number(curve[3])];
      const animation = reduced()
        ? animate(el, { opacity: [fromOpacity, down ? tokens.getPropertyValue("--press-opacity").trim() : "1"] }, { duration: seconds })
        : animate(el, { transform: [fromTransform, target] }, { duration: seconds, ease });
      const effect = { animation, restore };
      effects.set(el, effect);
      void animation.then(() => {
        if (effects.get(el) !== effect || down) return;
        animation.cancel(); restore(); effects.delete(el);
      });
    };
    let pressing: Element | null = null;
    const clear = () => {
      const el = pressing;
      if (el && pointerHeld) move(el, false);
      pressing?.removeAttribute("data-pressed"); pressing = null;
      pointerHeld = false;
    };
    createEffect(() => {
      if (reduced()) {
        stop();
        if (pressing && pointerHeld) move(pressing, true);
      }
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
      pointerHeld = el !== null;
      if (el) move(el, true);
      el?.setAttribute("data-pressed", "true");
    };

    const key = (event: KeyboardEvent) => {
      pointerHeld = false; stop();
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

    const drag = () => { pointerHeld = false; clear(); stop(); };
    view.addEventListener("dragstart", drag, true);
    view.addEventListener("blur", blur, true);
    const endings = ["pointerup", "pointercancel", "lostpointercapture", "keyup"] as const;

    for (const name of endings) view.addEventListener(name, clear, true);

    return () => {
      pointerHeld = false; clear(); stop(); dispose();
      view.removeEventListener("dragstart", drag, true);
      view.removeEventListener("blur", blur, true);
      doc.removeEventListener("pointerdown", pointer, true);
      doc.removeEventListener("pointerout", leave, true);
      doc.removeEventListener("keydown", key, true);

      for (const name of endings) view.removeEventListener(name, clear, true);
    };
  });
}
