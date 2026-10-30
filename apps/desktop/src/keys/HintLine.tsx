import { KeyHint } from "./KeyHint";
import { createEffect, createMemo, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { hintsFor, LEADER } from "./chords";
import type { HintPlace } from "./chords";
import { copy } from "./copy";
import { captureActions, endLeader, leaderArmed, modalOpen } from "./registry";

/** Where keyboard focus sits, for the hint line: `null` anywhere that has no hints, a modal layer such as Help included (U2230a). */
const placeAt = (focus: Element | null): HintPlace | null =>
  !focus || focus.closest(".help") ? null
    : focus.closest(".switcher") ? "switcher"
    : focus.closest(".pad-rich-editor, [contenteditable=true]") ? "editor"
    : focus.closest(".pad-body") ? "pad"
    : focus.closest(".drawer") ? "drawer"
    : focus.closest("[role=dialog]") ? null
    : focus.closest("[data-bubble]") ? "bubble"
    : focus.closest(".shelf") ? "shelf"
    : focus.closest('[role="tree"]') ? "rail"
    : focus.closest(".pane-screen") ? "agent"
    : null;

/** U2230a: the quiet line of the keys that act where focus is, from the same `CHORDS` rows Help lists and the registry binds. */
export const HintLine = () => {
  const [focus, setFocus] = createSignal<Element | null>(null);

  const actions = createMemo(() => captureActions(focus()));
  const place = createMemo(() => placeAt(focus()));

  const hints = () => {
    if (modalOpen()) return [];

    if (leaderArmed()) {
      const available = actions();

      return LEADER.filter(key => {
        const matches = available.filter(row => row.value === `action:leader:${key.keys}`);

        return matches.some(action => action.available());
      }).map(key => ({ keys: key.keys, label: key.short }));
    }

    const at = place();

    if (at === null) return [];

    const shown = hintsFor(at);

    if (at !== "shelf") return shown;

    // The Shelf's own hints follow its state: Restore while maximised, and Export only where `e` acts, on a Pad row.
    const maximised = focus()?.closest(".window")?.getAttribute("data-shelf-maximised") === "true";
    const focused = focus();
    const rowButton = focused?.matches(".todo-row-button, .pad-name") === true;
    const onPad = rowButton && focused?.closest(".pad-inset") != null;
    const canAssign = rowButton && !focused?.closest(".todo-done-fold");
    const editing = focused?.closest("input,textarea,select,[contenteditable]") != null;
    const modal = document.querySelector('[role=dialog], [role=alertdialog], [role=menu][data-state=open], .drawer[data-open="true"]') != null;

    if (editing || modal) return [];

    return shown
      .filter((hint) => hint.keys !== "1–9" || choices(hint.keys).length > 0)
      .filter((hint) => hint.label !== copy.exportMd || onPad)
      .filter((hint) => hint.label !== copy.assign || canAssign)
      .filter((hint) => hint.label !== copy.deleteFocusedRow || rowButton)
      .filter((hint) => hint.label !== copy.maximise || focus()?.closest(".window")?.getAttribute("data-shelf-mode") !== "overlay")
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
    actions();
    queueMicrotask(fit);
  });

  onMount(() => {
    const resize = new ResizeObserver(fit);

    if (line) resize.observe(line);

    onCleanup(() => resize.disconnect());

    // Both events settle in a microtask, when `activeElement` is where focus went.
    const sync = () => queueMicrotask(() => {
      if (!line?.contains(document.activeElement)) setFocus(document.activeElement);
    });

    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    sync();

    onCleanup(() => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
    });
  });

  const choices = (keys: string) => actions().filter(row => row.action.keys === keys && ("press" in row.action) === leaderArmed());

  const run = (action: ReturnType<typeof captureActions>[number]) => {
    if (modalOpen() || !focus()?.isConnected) return;

    if (document.activeElement instanceof HTMLElement && line?.contains(document.activeElement) && focus() instanceof HTMLElement) {
      const target = focus();

      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    }

    if (!action.available()) return;

    if (leaderArmed()) endLeader();
    action.run();
  };

  return (
    <p class="hint-line" classList={{ leader: leaderArmed() }} role={leaderArmed() ? "status" : undefined} aria-label={leaderArmed() ? copy.leaderPanel : undefined} ref={line} data-place={place() ?? undefined}>
      <For each={hints()}>{(hint) => <Show when={hint.keys === "1–9"} fallback={
        <button type="button" class="hint hint-action" data-hint={hint.keys} disabled={!choices(hint.keys).some(action => action.available())}
          onPointerDown={event => event.preventDefault()} onClick={() => { const action = choices(hint.keys)[0];

 if (action) run(action); }}>
          <KeyHint bare keys={hint.keys}>{hint.label}</KeyHint>
        </button>
      }>
        <span class="hint key-hint"><For each={choices(hint.keys)}>{action =>
          <button type="button" class="hint-action" data-hint={action.press} aria-label={action.label} disabled={!action.available()}
            onPointerDown={event => event.preventDefault()} onClick={() => run(action)}><KeyHint bare keys={action.press?.replace("Digit", "") ?? ""} children={null} /></button>
        }</For><span class="key-hint-label">{hint.label}</span></span>
      </Show>}</For>
    </p>
  );
};
