import { onCleanup } from "solid-js";
import { matchKeybindingPress, parseKeybinding } from "tinykeys";

/** Regions follow focus; active layers precede regions. Nested elements precede their ancestors; a portalled layer names its parent scope.
 * A modal also suppresses unbound shortcuts; Escape and Tab remain the Dialog's responsibility. */
export type KeyScope =
  | { kind: "app" }
  | { kind: "region"; element: () => HTMLElement | undefined }
  | { kind: "layer"; element: () => HTMLElement | undefined; active: () => boolean; modal: boolean; parent?: KeyScope };

type Binding = { chords: readonly string[]; when?: (event: KeyboardEvent) => boolean; run: (event: KeyboardEvent) => void };

type Registration = { scope: KeyScope; bindings: { matches: ReturnType<typeof parseKeybinding>[number][]; when: Binding["when"]; run: Binding["run"] }[] };

const registrations = new Set<Registration>();

const rootOf = (scope: KeyScope) => scope.kind === "app" ? undefined : scope.element();

const depth = (scope: KeyScope): number => {
  if (scope.kind === "layer" && scope.parent) return depth(scope.parent) + 1;

  let element = rootOf(scope);
  let count = 0;

  while (element) { count++; element = element.parentElement ?? undefined; }

  return count;
};

const rank = (scope: KeyScope) => scope.kind === "layer" ? 2 : scope.kind === "region" ? 1 : 0;

const dispatch = (event: KeyboardEvent): void => {
  if (!(event instanceof KeyboardEvent)) return;

  const focus = document.activeElement;

  const eligible = [...registrations].filter(({ scope }) => {
    if (scope.kind === "app") return true;

    if (scope.kind === "layer") return scope.active();

    return !!focus && !!scope.element()?.contains(focus);
  }).sort((a, b) => rank(b.scope) - rank(a.scope) || depth(b.scope) - depth(a.scope));

  const layer = eligible.find(({ scope }) => scope.kind === "layer");
  const modal = eligible.some(({ scope }) => scope.kind === "layer" && scope.modal);
  const region = eligible.find(({ scope }) => scope.kind === "region");

  for (const registration of eligible) {
    const { scope } = registration;

    if (scope.kind === "layer" && scope !== layer?.scope) continue;

    if (scope.kind === "region" && scope !== region?.scope) continue;

    if (modal && scope.kind !== "layer") continue;

    for (const binding of registration.bindings) {
      if (!binding.matches.some((chord) => matchKeybindingPress(event, chord)) || binding.when?.(event) === false) continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      binding.run(event);

      return;
    }
  }

  if (modal && event.key !== "Escape" && event.key !== "Tab") event.stopImmediatePropagation();
};

/** Register within a Solid owner. Matching is tinykeys' job; guards and repeats belong to each caller.
 * The first owner installs one listener; disposing the last removes it, including across App remounts. */
export const registerKeys = (scope: KeyScope, bindings: readonly Binding[]): void => {
  const registration: Registration = { scope, bindings: bindings.map(({ chords, when, run }) => ({
    matches: chords.map((chord) => parseKeybinding(chord)[0]!), when, run,
  })) };

  if (registrations.size === 0) window.addEventListener("keydown", dispatch, true);
  registrations.add(registration);
  onCleanup(() => {
    registrations.delete(registration);

    if (registrations.size === 0) window.removeEventListener("keydown", dispatch, true);
  });
};
