import { captureFocus } from "../keys/focus";
import type { Place } from "./places";
import type { Screens } from "../terminal/screens";

export const focusPane = (): void => {
  const target = document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]");
  target?.focus();

  if (document.activeElement !== target) document.querySelector<HTMLElement>(".terminal-new")?.focus();
};

export const bubbleElement = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-bubble="${id}"]`);

export const focusItem = (id: string, place: Place | undefined, screens: Screens): void => {
  if (place?.min) document.querySelector<HTMLElement>(`.terminal-tab[data-bubble="${id}"]`)?.focus();
  else screens.emulatorFor(id).focus();
};

export const focusedId = (active: Element | null = document.activeElement): string | null => {
  return active instanceof Element ? (active.closest<HTMLElement>("[data-bubble]")?.dataset.bubble ?? null) : null;
};

/** Closing from a Bubble returns focus only while that action still owns it; a tab keeps its own focus. */
export const closeFocused = (focus: Element | null, back: Element | null, close: (id: string) => Promise<boolean>): void => {
  const id = focusedId(focus);

  if (id === null) return;

  const focusReturn = captureFocus();
  const fromTab = focus?.closest(".terminal-tabs") !== null;

  void close(id).then(removed => {
    if (!removed || fromTab) return;

    focusReturn(() => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
      else focusPane();
    });
  });
};
