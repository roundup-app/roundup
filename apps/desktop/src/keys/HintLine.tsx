import { KeyChip } from "./KeyChip";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { hintsFor } from "./chords";
import type { HintPlace } from "./chords";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";

/** The pane's state mark while an Agent is Managed (U375). */
const MANAGED = '.pane-control[data-state="managed"]';

/** Where keyboard focus sits, for the hint line: `null` anywhere that has no hints, a modal layer such as Help included (U2230a). */
const placeAt = (focus: Element | null, selectedIsAgent: boolean): HintPlace | null => {
  const inWatchedPane = selectedIsAgent && focus?.closest(".pane")?.querySelector(MANAGED) != null;

  return !focus || focus.closest(".help") ? null
    : focus.closest(".switcher") ? "switcher"
    : focus.closest(".pad-rich-editor, [contenteditable=true]") ? "editor"
    : focus.closest(".pad-body") ? "pad"
    : focus.closest(".drawer") ? "drawer"
    : focus.closest("[role=dialog]") ? null
    : focus.closest("[data-bubble]") ? "bubble"
    : focus.closest(".shelf") ? "shelf"
    : focus.closest('[role="tree"]') ? "rail"
    : inWatchedPane || focus.closest(".pane-screen") ? "agent"
    : null;
};

/** U2230a: the quiet line of the keys that act where focus is, from the same `CHORDS` rows Help lists and the registry binds. */
export const HintLine = () => {
  const { rail, takeover } = useConnectedProject();
  const [focus, setFocus] = createSignal<Element | null>(null);
  const [watched, setWatched] = createSignal(0);

  const selectedIsAgent = () => {
    watched();

    return rail.nodes.find((node) => node.id === rail.selected())?.kind === "agent";
  };

  const place = createMemo(() => placeAt(focus(), selectedIsAgent()));

  const watching = () => selectedIsAgent() && takeover.taken() !== rail.selected() && document.querySelector(`.pane ${MANAGED}`) != null;

  const hints = () => {
    const at = place();

    if (at === null) return [];

    const shown = hintsFor(at, watching());

    if (at !== "shelf") return shown;

    // The Shelf's own hints follow its state: Restore while maximised, and Export only where `e` acts, on a Pad row.
    const maximised = focus()?.closest(".window")?.getAttribute("data-shelf-maximised") === "true";
    const onPad = focus()?.closest(".pad-inset") != null;

    return shown
      .filter((hint) => hint.label !== copy.exportMd || onPad)
      .filter((hint) => hint.label !== copy.assign || focus()?.closest("[data-shelf-row]") != null)
      .map((hint) => hint.label === copy.maximise && maximised ? { ...hint, label: copy.restore } : hint);
  };

  let line: HTMLParagraphElement | undefined;

  /** Hints drop from the end until the rest fit whole: one that would clip is hidden with every hint after it. */
  const fit = (): void => {
    if (!line) return;

    const children = [...line.children].filter((child): child is HTMLElement => child instanceof HTMLElement);

    for (const child of children) child.hidden = false;

    const room = line.clientWidth;
    const over = children.findIndex((child) => child.offsetLeft + child.offsetWidth > room);

    if (over !== -1) for (const child of children.slice(over)) child.hidden = true;
  };

  createEffect(() => {
    hints();
    fit();
  });

  onMount(() => {
    const resize = new ResizeObserver(fit);

    if (line) resize.observe(line);

    onCleanup(() => resize.disconnect());

    // Both events settle in a microtask, when `activeElement` is where focus went.
    const sync = () => queueMicrotask(() => setFocus(document.activeElement));

    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    sync();

    const panes = document.querySelectorAll(".pane, .pane-body");
    const observer = new MutationObserver(() => setWatched((count) => count + 1));

    for (const pane of panes) observer.observe(pane, { childList: true });

    onCleanup(() => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      observer.disconnect();
    });
  });

  return (
    <p class="hint-line" ref={line} data-place={place() ?? undefined}>
      <For each={hints()}>{(hint) => <span class="hint"><KeyChip keys={hint.keys} /> {hint.label}</span>}</For>
    </p>
  );
};
