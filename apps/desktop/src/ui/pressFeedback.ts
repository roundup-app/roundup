/** Adds transient feedback only; the platform and Ark retain all activation semantics. */
export function pressFeedback(doc: Document): () => void {
  let pressing: Element | null = null;
  const clear = () => { pressing?.removeAttribute("data-pressed"); pressing = null; };

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

  const pointer = (event: PointerEvent) => { if (event.button === 0) begin(control(event.composedPath()[0] ?? null)); };

  const key = (event: KeyboardEvent) => {
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

  view.addEventListener("blur", blur, true);
  const endings = ["pointerup", "pointercancel", "keyup", "dragstart"] as const;

  for (const name of endings) view.addEventListener(name, clear, true);

  return () => {
    clear();
    view.removeEventListener("blur", blur, true);
    doc.removeEventListener("pointerdown", pointer, true);
    doc.removeEventListener("pointerout", leave, true);
    doc.removeEventListener("keydown", key, true);

    for (const name of endings) view.removeEventListener(name, clear, true);
  };
}
