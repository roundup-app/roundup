import { createSignal, onCleanup } from "solid-js";
import { CHORDS, LEADER, chordsFor, leaderChord, TEXT_FIELDS } from "./chords";
import type { Chord, LeaderKey } from "./chords";
import { matchKeybindingPress, parseKeybinding } from "tinykeys";

/** Regions follow focus; active layers precede regions. Nested layers precede their ancestors; among independent layers, the one containing focus owns shortcuts.
 * A portalled child may name its parent scope; independent surfaces need no fabricated ancestry.
 * A modal also suppresses unbound shortcuts; Escape and Tab remain the Dialog's responsibility, and plain typing in its own text field stays the field's. */
export type KeyScope =
  | { kind: "app" }
  | { kind: "leader" }
  | { kind: "region"; element: () => HTMLElement | undefined }
  | { kind: "layer"; element: () => HTMLElement | undefined; active: () => boolean; modal: boolean; parent?: KeyScope };

export type ActivationSource = "key" | "pointer";

/** Native keyboard button activation has no pointer click count. */
export const activationSource = (event: Pick<MouseEvent, "detail">): ActivationSource => event.detail === 0 ? "key" : "pointer";

type Binding = { chords: readonly string[]; when?: (event: KeyboardEvent) => boolean; run: (event: KeyboardEvent) => void };

type ActionBinding = { action: Chord | LeaderKey; match?: "key"; when?: Binding["when"]; capture: (focus: Element | null) => { available: () => boolean; invoke: () => void } };

type Registration = { scope: KeyScope; actions: ActionBinding[]; bindings: { matches: ReturnType<typeof parseKeybinding>[number][]; when: Binding["when"]; run: Binding["run"] }[] };

const registrations = new Set<Registration>();

const rootOf = (scope: KeyScope) => scope.kind === "app" || scope.kind === "leader" ? undefined : scope.element();

const depth = (scope: KeyScope): number => {
  if (scope.kind === "layer" && scope.parent) return depth(scope.parent) + 1;

  let element = rootOf(scope);
  let count = 0;

  while (element) { count++; element = element.parentElement ?? undefined; }

  return count;
};

const containsScope = (outer: KeyScope, inner: KeyScope): boolean => {
  if (inner.kind === "layer" && inner.parent) {
    if (inner.parent === outer || containsScope(outer, inner.parent)) return true;
  }

  const outerRoot = rootOf(outer);
  const innerRoot = rootOf(inner);

  return !!outerRoot && !!innerRoot && outerRoot !== innerRoot && outerRoot.contains(innerRoot);
};

const rank = (scope: KeyScope) => scope.kind === "layer" ? 2 : scope.kind === "region" ? 1 : 0;

/** A press with no ctrl, meta or alt inside a text field of a modal layer is the layer's own typing (a switcher's filter); it passes to the field. */
const typesInto = (event: KeyboardEvent, eligible: readonly Registration[]): boolean => {
  const target = event.target;

  return !event.ctrlKey && !event.metaKey && !event.altKey && target instanceof Element && target.matches(TEXT_FIELDS)
    && eligible.some(({ scope }) => scope.kind === "layer" && scope.modal && scope.element()?.contains(target) === true);
};

const [armed, setArmed] = createSignal(false);

/** The code whose key repeat is swallowed: the `⌘K` that armed the leader, or the key that ended its wait (U2239). */
let held: string | null = null;

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

/** U2239: whether `⌘K` is waiting for its next key. */
export const leaderArmed = armed;

/** `⌘K`'s run: the leader waits for one key. */
export const armLeader = (event: KeyboardEvent): void => {
  held = event.code;
  setArmed(true);
};

export const endLeader = (): void => void setArmed(false);

/** Whether a modal layer is open (U479); the leader's wait ends when one opens. */
export const modalOpen = (): boolean => [...registrations].some(({ scope }) => scope.kind === "layer" && scope.modal && scope.active());

/** The wait's one key: a registered leader key runs, any other key ends the wait and runs nothing. Either way the webview handles it, so no Terminal, field or Rail sees it. A lone modifier changes nothing. */
const takeLeaderKey = (event: KeyboardEvent): void => {
  if (MODIFIER_KEYS.has(event.key)) return;

  const hit = [...registrations].filter(({ scope }) => scope.kind === "leader").flatMap(({ bindings }) => bindings)
    .find((binding) => binding.matches.some((chord) => matchKeybindingPress(event, chord)) && binding.when?.(event) !== false);

  event.preventDefault();
  event.stopImmediatePropagation();
  held = event.code;
  setArmed(false);
  hit?.run(event);
};

const dispatch = (event: KeyboardEvent): void => {
  if (!(event instanceof KeyboardEvent)) return;

  const target = event.composedPath()[0];

  const editing = target instanceof HTMLElement
    && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable);

  // U2770: update before a shortcut consumes the press; editing alone keeps the field's ring steady.
  if (!event.isComposing && (!editing || event.key === "Tab" || event.key === "Escape")) {
    document.documentElement.dataset.keyboardFocus = "true";
  }

  if (event.repeat && event.code === held) {
    event.preventDefault();
    event.stopImmediatePropagation();

    return;
  }

  if (!event.repeat) held = null;

  if (armed()) {
    takeLeaderKey(event);

    return;
  }

  const focus = document.activeElement;

  const eligible = [...registrations].filter(({ scope }) => {
    if (scope.kind === "leader") return false;

    if (scope.kind === "app") return true;

    if (scope.kind === "layer") return scope.active();

    return !!focus && !!scope.element()?.contains(focus);
  }).sort((a, b) => {
    if (a.scope.kind === "layer" && b.scope.kind === "layer") {
      if (containsScope(a.scope, b.scope)) return 1;

      if (containsScope(b.scope, a.scope)) return -1;

      const focused = (scope: KeyScope) => !!focus && !!rootOf(scope)?.contains(focus);
      const ownership = Number(focused(b.scope)) - Number(focused(a.scope));

      if (ownership) return ownership;
    }

    return rank(b.scope) - rank(a.scope) || depth(b.scope) - depth(a.scope);
  });

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
      document.documentElement.dataset.keyboardFocus = "true";
      binding.run(event);

      return;
    }
  }

  if (modal && event.key !== "Escape" && event.key !== "Tab" && !typesInto(event, eligible)) event.stopImmediatePropagation();
};

/** Register within a Solid owner. Matching is tinykeys' job; guards and repeats belong to each caller.
 * The first owner installs one listener; disposing the last removes it, including across App remounts. */
export const registerKeys = (scope: KeyScope, bindings: readonly (Binding | ActionBinding)[]): void => {
  const actions = bindings.filter((binding): binding is ActionBinding => "action" in binding);

  const keys = bindings.map((binding): Binding => {
    if (!("action" in binding)) return binding;

    const key: Binding = {
      chords: "presses" in binding.action ? chordsFor(binding.action.keys, binding.match) : leaderChord(binding.action.keys),
      run: (event) => {
        const captured = binding.capture(event.target instanceof Element ? event.target : document.activeElement);

        if (!event.repeat && captured.available()) captured.invoke();
      },
    };

    if (binding.when) key.when = binding.when;

    return key;
  });

  const registration: Registration = { scope, actions, bindings: keys.map(({ chords, when, run }) => ({
    matches: chords.map((chord) => parseKeybinding(chord)[0]!), when, run,
  })) };

  if (registrations.size === 0) window.addEventListener("keydown", dispatch, true);
  registrations.add(registration);
  onCleanup(() => {
    registrations.delete(registration);

    if (registrations.size === 0) window.removeEventListener("keydown", dispatch, true);
  });
};

/** U2572: capture the registered owners before a modal moves focus. Each invocation rechecks that same owner and target; no DOM key event is manufactured or dispatched. */
export const captureActions = (focus: Element | null): { value: string; label: string; keys: string; available: () => boolean; run: () => void }[] => {
  if (modalOpen()) return [];

  const rows = [...CHORDS, ...LEADER];

  return [...registrations].flatMap((registration) => registration.actions.map((binding) => {
    const captured = binding.capture(focus);
    const leader = "press" in binding.action;

    const available = () => registrations.has(registration) && captured.available();

    return {
      value: `action:${leader ? "leader" : "chord"}:${binding.action.keys}`,
      label: binding.action.what,
      keys: leader ? `${CHORDS.find((row) => row.keys === "⌘K")!.keys} ${binding.action.keys}` : binding.action.keys,
      available,
      run: () => { if (available()) captured.invoke(); },
      at: rows.indexOf(binding.action),
    };
  })).sort((a, b) => a.at - b.at);
};
