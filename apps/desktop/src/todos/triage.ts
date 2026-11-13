import { captureFocus } from "../keys/focus";
import { createSignal } from "solid-js";

/** U3751: the mode's one flag, a webview state of the Todos tab that is never saved. */
const [on, setOn] = createSignal(false);

/** U3753: the Todo whose Drawer comment field is asked to take focus once it exists. */
const [commentFor, setCommentFor] = createSignal<number | null>(null);

let commentFocus = captureFocus();

export const triage = {
  on, set: setOn, commentFor,
  canKey: (event: KeyboardEvent, section: HTMLElement | undefined, todosTab: boolean, nesting = false) => section?.isConnected === true && !section.closest("[hidden], [inert]") && todosTab
    && event.target instanceof Element && (event.target === document.body || event.target.closest(".shelf, .shelf-tabs") !== null)
    && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && (!event.shiftKey || nesting && event.code === "Tab")
    && !event.target.closest("input, textarea, select, [contenteditable]")
    && !document.querySelector("[role=dialog], [role=alertdialog], [role=menu][data-state=open]"),
  askComment: (id: number | null) => { if (id !== null) commentFocus = captureFocus(true); setCommentFor(id); },
  focusComment: (move: () => void) => commentFocus(move),
};

export { idOfRow, rowButtonOf } from "./listModel";
