/** Observe native keyboard presses for paint only; the browser and Ark retain activation ownership. */
export const trackPress = (doc: Document): (() => void) => {
  let pressed: Element | null = null;

  const clear = () => {
    pressed?.removeAttribute("data-key-pressed");
    pressed = null;
  };

  const down = (event: KeyboardEvent) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return;
    const control = event.target.closest('button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="treeitem"], input[type="checkbox"], input[type="radio"]');

    if (!control || event.target.closest('textarea, input:not([type="checkbox"], [type="radio"]), [contenteditable="true"]') || control.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return;
    const enter = event.key === "Enter" && !control.matches("input");
    const space = event.key === " " && !control.matches("a[href]");

    if (!enter && !space) return;
    clear();
    pressed = control;
    pressed.setAttribute("data-key-pressed", "");
  };

  doc.addEventListener("keydown", down, true);
  doc.addEventListener("keyup", clear, true);
  doc.addEventListener("focusout", clear, true);
  doc.addEventListener("pointerdown", clear, true);
  doc.addEventListener("pointercancel", clear, true);
  doc.defaultView?.addEventListener("blur", clear);

  return () => {
    clear();
    doc.removeEventListener("keydown", down, true);
    doc.removeEventListener("keyup", clear, true);
    doc.removeEventListener("focusout", clear, true);
    doc.removeEventListener("pointerdown", clear, true);
    doc.removeEventListener("pointercancel", clear, true);
    doc.defaultView?.removeEventListener("blur", clear);
  };
};
