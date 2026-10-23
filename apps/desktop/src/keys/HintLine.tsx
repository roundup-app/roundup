import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { CHORDS, hintsFor } from "./chords";
import type { HintPlace } from "./chords";
import { captureActions } from "./registry";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";

/** U3513: Help and hints agree on keyboard ownership. Typing and other modal owners keep their keys. */
export const hintPlaceAt = (focus: Element | null): HintPlace | null => {
  if (!focus || focus.closest('.help, input, textarea, select, [contenteditable], .xterm, .pane-screen, [role=menu], [role=alertdialog]')) return null;

  if (focus.closest('[role=dialog]') && !focus.closest('.switcher')) return null;

  if (focus.closest('.switcher')) return "switcher";

  if (focus.closest('.pad-body')) return "pad";

  if (focus.closest('.drawer')) return "drawer";

  if (focus.closest('[data-bubble], .terminal-tab')) return "bubble";

  if (focus.closest('.shelf')) {
    if (focus.closest('.shelf')?.querySelector('[data-triage-toggle][aria-pressed=true]')) return "triage";

    if (focus.closest('.pad-name')) return "pads";

    if (focus.closest('.todo-row-button')) return "todos";

    return "shelf";
  }

  if (focus.closest('[role=tree]')) return "rail";

  if (focus.closest('.pane') && document.querySelector('.pane-empty-keys')) return "empty";

  if (focus.closest('.pane')) return "agent";

  return null;
};

/** One focused context, one quiet line, with Help always retained when space is scarce. */
export const HintLine = () => {
  const { rail, takeover } = useConnectedProject();
  const [focus, setFocus] = createSignal<Element | null>(null);
  const [revision, setRevision] = createSignal(0);

  const place = createMemo(() => {
    revision();

    return hintPlaceAt(focus());
  });

  const mount = () => {
    const held = focus();
    const at = place();

    if (at === "triage" || at === "shelf" || at === "todos" || at === "pads") return held?.closest('.shelf');

    if (at === "drawer" || at === "pad") return held?.closest('.drawer, .pad-body');

    if (at === "switcher") return held?.closest('.switcher');

    if (at === "bubble") return held?.closest('[data-bubble]');

    if (at === "empty") return document.querySelector('.pane-empty-keys');

    return null;
  };

  const hints = createMemo(() => {
    revision();
    const at = place();
    const held = focus();

    if (at === null) return [];
    const actions = captureActions(held);
    const available = (keys: string) => actions.some(action => action.keys === keys && action.available());

    let shown = hintsFor(at).filter(hint => {
      if (at === "switcher" && hint.label === copy.hintTakeControl) return held?.closest('.switcher')?.getAttribute('data-can-take') === "true";

      if ([copy.hintSwitchTerminal, copy.hintTakeControl, copy.newAgent.toLowerCase(), copy.newTerminal.toLowerCase()].includes(hint.label)) return available(hint.keys);

      if (hint.label === copy.maximise.toLowerCase()) return held?.closest('.window')?.getAttribute('data-shelf-mode') !== "overlay";

      if ((at === "todos" || at === "pads") && hint.label === copy.assign.toLowerCase()) return !held?.closest('.todo-done-fold');

      if (hint.label === copy.close.toLowerCase() && at === "pad") return !!held?.closest('.drawer');

      if (at === "triage") return !!held?.closest('.todo-row-button') && !held.closest('.todo-done-fold');

      return true;
    });

    if (at === "switcher" && held?.closest('.switcher')?.getAttribute('data-has-result') === "true") {
      shown = [{ keys: CHORDS.find(row => row.what === copy.todoLift)!.keys, label: copy.hintOpen }, ...shown];
    }

    return [...shown.slice(0, 3).map(hint => ({ ...hint, label: hint.label === copy.maximise.toLowerCase() && held?.closest('.window')?.getAttribute('data-shelf-maximised') === "true" ? copy.restore.toLowerCase()
      : (at === "rail" || at === "agent") && hint.label === copy.hintTakeControl && takeover.taken() === rail.selected() ? copy.hintGiveControl : hint.label })), { keys: "?", label: copy.hintMore }];
  });

  const fit = () => {
    const line = document.querySelector<HTMLParagraphElement>('.hint-line');

    if (!line) return;
    const children = [...line.children].filter((child): child is HTMLElement => child instanceof HTMLElement);

    for (const child of children) child.hidden = false;
    const more = children.at(-1);

    for (let count = children.length - 2; count >= 0 && more && more.getBoundingClientRect().right > line.getBoundingClientRect().right; count--) children[count]!.hidden = true;
  };

  createEffect(() => { hints(); queueMicrotask(fit); });
  onMount(() => {
    const resize = new ResizeObserver(fit);
    const sync = () => queueMicrotask(() => setFocus(document.activeElement));
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    sync();

    // Row content changes do not change keyboard ownership; only these context marks need a DOM observer.
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target instanceof Element && record.target.matches('.window, .switcher, [data-triage-toggle]'))) setRevision(now => now + 1);
    });

    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'data-shelf-mode', 'data-shelf-maximised', 'data-can-take', 'data-has-result'] });
    createEffect(() => {
      place();
      queueMicrotask(() => {
        resize.disconnect();
        const line = document.querySelector('.hint-line');

        if (line) resize.observe(line);
      });
    });
    onCleanup(() => { resize.disconnect(); observer.disconnect(); document.removeEventListener("focusin", sync); document.removeEventListener("focusout", sync); });
  });

  const content = () => <p class="hint-line" data-place={place() ?? undefined}>
    <For each={hints()}>{hint => <span class="hint"><kbd>{hint.keys}</kbd> <span>{hint.label}</span></span>}</For>
  </p>;

  return <Show when={place() !== null}><Show when={mount()} fallback={content()}>{target => <Portal mount={target()}>{content()}</Portal>}</Show></Show>;
};
