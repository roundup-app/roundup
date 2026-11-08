import { makeEventListener } from "@solid-primitives/event-listener";
import { createRoot } from "solid-js";
import "./press.css";

/** Ends feedback before the existing drag owner measures and lifts its source. */
export function clearPress(element: Element): void {
  element.removeAttribute("data-pressed");
}

/** Adds transient feedback only; the platform and Ark retain all activation semantics. */
export function pressFeedback(doc: Document): () => void {
  return createRoot(dispose => {
    let pressing: Element | null = null;
    let pointerDown = false;

    const clear = () => {
      pressing?.removeAttribute("data-pressed"); pressing = null;
      pointerDown = false;
    };

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
      el?.setAttribute("data-pressed", "true");
    };

    const key = (event: KeyboardEvent) => {
      if (pointerDown) return;
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

    makeEventListener(doc, "pointerdown", pointer, true);
    makeEventListener(doc, "pointerout", leave, true);
    makeEventListener(doc, "keydown", key, true);

    const blur = (event: Event) => {
      const target = event.composedPath()[0];

      if (target === event.currentTarget || (target instanceof Node && pressing?.contains(target))) clear();
    };

    const drag = () => { pointerDown = false; clear(); };

    makeEventListener(view, "dragstart", drag, true);
    makeEventListener(view, "blur", blur, true);
    const keyup = () => { if (!pointerDown) clear(); };

    makeEventListener(view, "keyup", keyup, true);

    for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) makeEventListener(view, name, clear, true);

    return () => { pointerDown = false; clear(); dispose(); };
  });
}
