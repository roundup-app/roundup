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
