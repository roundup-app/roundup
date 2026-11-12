/** A click can leave focus on the page body or a control of `surface` when it names one rather than the row (the webview does not focus a clicked button). Whether a key press is such a press, with no field, Drawer, dialog or menu to own it (U6829a). */
export const strandedFocus = (event: KeyboardEvent, surface?: string): boolean => event.target instanceof Element && !event.isComposing
  && (event.target === document.body || surface !== undefined && event.target.closest(surface) !== null)
  && !event.target.closest("input, textarea, select, [contenteditable], .todo-blocker, .drawer, [role=dialog], [role=alertdialog], [role=menu]")
  && !document.querySelector('.drawer[data-open="true"], [role=dialog], [role=alertdialog], [role=menu]');
