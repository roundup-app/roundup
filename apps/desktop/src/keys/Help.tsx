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

  registerKeys({ kind: "app" }, [{ chords: HELP_KEYS, when: (press) => opensFrom(press.target), run: show }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [
    { chords: HELP_KEYS, run: () => setOpen(false) },
  ]);

  return (
    <Show when={open()}>
    <Dialog.Root open onOpenChange={({ open }) => setOpen(open)}
      initialFocusEl={() => panel ?? null}
      finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}
      onEscapeKeyDown={(event) => event.stopImmediatePropagation()}>
      <Dialog.Content class="help" aria-label={copy.help} ref={(element) => (panel = element)}>
        <For each={HELP_ROWS}>
          {(chord) => (
            <p class="help-line">
              <span class="help-keys">{chord.keys}</span>
              {`  ${chord.what}`}
            </p>
          )}
        </For>
        <section class="help-shelf" aria-label={copy.shelfKeys}>
        <p><span class="help-keys">{copy.previousNextKeys}</span>{copy.focusThePreviousNextShelfRow}</p>
        <p><span class="help-keys">{copy.enter}</span>{copy.toggleTheFocusedShelfRowSelection}</p>
        <p><span class="help-keys">{copy.rangeKeys}</span>{copy.selectARangeOfShelfRows}</p>
        <p><span class="help-keys">{copy.esc}</span>{copy.deleteSelectedShelfRowsCancelSelection}</p>
        </section>
      </Dialog.Content>
    </Dialog.Root>
    </Show>
  );
};
