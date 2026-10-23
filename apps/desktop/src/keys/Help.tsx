import { KeyChip } from "./KeyChip";
import { copy } from "../copy";
import { createSignal, For, Show } from "solid-js";
import { HELP_KEYS, HELP_ROWS } from "./chords";
import { placeOf } from "./places";
import { registerKeys } from "./registry";
import { Dialog } from "../ui/Dialog";

const inTextField = (target: Element): boolean => target.closest('input, textarea, select, [contenteditable="true"]') !== null;

/** `?` opens Help from the Rail or the pane's frame, never from a text field, a Terminal, a Drawer or the switcher (U54). */
const opensFrom = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element) || inTextField(target) || target.closest(".pane-screen")) return false;

  const place = placeOf(target);

  return place === "rail" || place === "pane";
};

/** The panel `?` opens over the centre pane, one line per chord. It holds focus while open; Esc, `?` or a click outside closes it and focus returns to where it was. */
export const Help = () => {
  const [open, setOpen] = createSignal(false);
  let panel: HTMLElement | undefined;
  let returnTo: Element | null = null;

  const show = (): void => {
    returnTo = document.activeElement;
    setOpen(true);
  };

  const close = (): void => {
    setOpen(false);

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };

  registerKeys({ kind: "app" }, [{ chords: HELP_KEYS, when: (press) => opensFrom(press.target), run: show }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [
    { chords: [...HELP_KEYS, "Escape"], run: close },
  ]);

  return (
    <Show when={open()}>
    <Dialog.Root open onOpenChange={({ open }) => { if (!open) close(); }}
      initialFocusEl={() => panel ?? null}
      finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}
      onEscapeKeyDown={(event) => event.stopImmediatePropagation()}>
      <Dialog.Content class="help" aria-label={copy.help} ref={(element) => { panel = element; queueMicrotask(() => element.isConnected && element.focus({ preventScroll: true })); }}>
        <p>{copy.helpShortcutScopes}</p>
        <For each={HELP_ROWS}>
          {(chord) => (
            <p class="help-line">
              <KeyChip keys={chord.keys} />
              {`  ${chord.what}`}
            </p>
          )}
        </For>
        <section class="help-shelf" aria-label={copy.shelfKeys}>
        <p><KeyChip keys={copy.previousNextKeys} />{" "}{copy.focusThePreviousNextShelfRow}</p>
        <p><KeyChip keys={copy.enter} />{" "}{copy.toggleTheFocusedShelfRowSelection}</p>
        <p><KeyChip keys={copy.rangeKeys} />{" "}{copy.selectARangeOfShelfRows}</p>
        <p><KeyChip keys={copy.esc} />{" "}{copy.deleteSelectedShelfRowsCancelSelection}</p>
        </section>
      </Dialog.Content>
    </Dialog.Root>
    </Show>
  );
};
