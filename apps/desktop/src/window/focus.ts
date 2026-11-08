import { createEventSignal, makeEventListener } from "@solid-primitives/event-listener";
import { createSignal } from "solid-js";

/** U3566: `menu` is the window opened from its menu; unread results wait there until the user's own click or key. */
type WindowFocus = "blurred" | "focused" | "menu";

/** The window's focus and visibility, and the element that last took focus (the Project menu reads it). */
export const createWindowFocus = () => {
  const [focus, setFocus] = createSignal<WindowFocus>(document.hasFocus() ? "focused" : "blurred");
  const changed = createEventSignal(document, "visibilitychange");
  const [menuFocus, setMenuFocus] = createSignal<Element | null>(null);
  const interact = () => { if (document.hasFocus()) setFocus("focused"); };

  makeEventListener(window, "focus", () => setFocus(previous => previous === "menu" ? previous : "focused"));
  makeEventListener(window, "blur", () => setFocus("blurred"));
  makeEventListener(window, "click", interact);
  makeEventListener(window, "keydown", interact);
  makeEventListener(document, "focusin", () => setMenuFocus(document.activeElement));

  return {
    focus,
    setFocus,
    menuFocus,
    visible: () => { changed(); return document.visibilityState !== "hidden"; },
  };
};
