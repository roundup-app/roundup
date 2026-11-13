import { captureFocus } from "../keys/focus";
import { modalOpen } from "../keys/registry";
import { surfaceOpen } from "../ui/openSurfaces";
import { createSignal } from "solid-js";

/** U3751: the mode's one flag, a webview state of the Todos tab that is never saved. */
const [on, setOn] = createSignal(false);

/** U3753: the Todo whose Drawer comment field is asked to take focus once it exists. */
const [commentFor, setCommentFor] = createSignal<number | null>(null);

let commentFocus = captureFocus();

/** U3474a: a press with no repeat, composition or modifier; Shift only for a nested Tab. */
const plain = (event: KeyboardEvent, nesting: boolean) => !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && (!event.shiftKey || nesting && event.code === "Tab");

export const triage = {
  on, set: setOn, commentFor,
  canKey: (event: KeyboardEvent, section: HTMLElement | undefined, todosTab: boolean, nesting = false) => section?.isConnected === true && !section.closest("[hidden], [inert]") && todosTab
    && event.target instanceof Element && (event.target === document.body || event.target.closest(".shelf, .shelf-tabs") !== null)
    && plain(event, nesting)
    && !event.target.closest("input, textarea, select, [contenteditable]")
    && !modalOpen() && !surfaceOpen(),
  askComment: (id: number | null) => { if (id !== null) commentFocus = captureFocus(true); setCommentFor(id); },
  focusComment: (move: () => void) => commentFocus(move),
};

export { idOfRow, rowButtonOf } from "./listModel";
