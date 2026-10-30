import { captureFocus } from "./focus";
import { KeyHint } from "./KeyHint";
import { copy } from "./copy";
import { createSignal, For, Show } from "solid-js";
import { CHORDS, HELP_KEYS, LEADER } from "./chords";
import { captureActions, registerKeys } from "./registry";
import { Dialog } from "../ui/Dialog";

const bubbleScopes = new Map(Object.entries(copy.helpBubbleScope));

const rowScopes = new Map(Object.entries(copy.helpRowScope));

const sections = (projectOpen: boolean, shelfOpen: boolean) => projectOpen ? [
  { title: copy.helpScope.app, rows: CHORDS.filter(row => !row.inFirstRun && !row.inRail && !row.inTerminals && !row.inShelf && !row.inEditor) },
  { title: copy.helpScope.leader, rows: LEADER.map(row => ({ ...row, keys: `${copy.leaderChord} ${row.keys}`, what: row.keys === "B" ? (shelfOpen ? copy.closeShelf : copy.openShelf) : bubbleScopes.get(row.keys) ?? row.what })) },
  // #3853 adds the Terminal Find owner; until then its menu catalogue entry has no working key to advertise.
  { title: copy.helpScope.terminals, rows: CHORDS.filter(row => row.inTerminals && row.keys !== "⌘F") },
  { title: copy.helpScope.editor, rows: [{ ...CHORDS.find(row => row.keys === "⌘B")!, what: copy.bold }, ...CHORDS.filter(row => row.inEditor)] },
  { title: copy.helpScope.rail, rows: CHORDS.filter(row => row.inRail) },
  { title: copy.helpScope.shelf, rows: CHORDS.filter(row => row.inShelf && !row.inTriage && row.keys !== "T").map(row => ({ ...row, what: rowScopes.get(row.keys) ?? row.what })) },
  { title: copy.helpScope.todos, rows: CHORDS.filter(row => row.inShelf && row.keys === "T") },
  { title: copy.helpScope.triage, rows: CHORDS.filter(row => row.inTriage) },
] : [{ title: copy.helpScope.app, rows: CHORDS.filter(row => row.inFirstRun || row.what === copy.captureATodo || row.what === copy.settings) }];

/** U4324a: plain text and Terminal input keep `?`; every other App surface offers Help. */
const opensFrom = (target: EventTarget | null): boolean => target instanceof Element
  && !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .pane-screen, .xterm, .bubble-body');

/** The panel `?` opens over the centre pane, one line per chord. It holds focus while open; Esc, `?` or a click outside closes it and focus returns to where it was. */
export const Help = (props: { projectOpen?: boolean; shelfOpen?: boolean }) => {
  const [open, setOpen] = createSignal(false);
  const [labels, setLabels] = createSignal(new Map<string, string>());
  let panel: HTMLElement | undefined;
  let returnTo: Element | null = null;
  let initialFocus = captureFocus();

  const show = (): void => {
    setLabels(new Map(captureActions(document.activeElement).filter(action => action.keys === "⇧⌘N").map(action => [action.keys, action.label])));
    initialFocus = captureFocus(true);
    returnTo = document.activeElement;
    setOpen(true);
  };

  const close = (): void => {
    setOpen(false);

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };

  registerKeys({ kind: "app" }, [{ action: CHORDS.find(row => row.keys === "?")!, chords: HELP_KEYS, when: press => opensFrom(press.target), capture: focus => ({
    available: () => !open() && !!focus?.isConnected && opensFrom(focus),
    invoke: show,
  }) }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [
    { chords: [...HELP_KEYS, "Escape"], run: close },
  ]);

  return (
    <Dialog.Root open={open()} onOpenChange={({ open }) => { if (!open) close(); }}
      initialFocusEl={() => panel ?? null}
      finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}
      onEscapeKeyDown={(event) => event.stopImmediatePropagation()}>
      <Dialog.Positioner><Dialog.Content class="help" aria-label={copy.help} ref={(element) => {
        panel = element;
        const focus = initialFocus;

        queueMicrotask(() => focus(() => { if (element.isConnected) element.focus({ preventScroll: true }); }));
      }}>
        <For each={sections(props.projectOpen ?? true, props.shelfOpen ?? false)}>{section => <section class="help-section">
          <h2>{section.title}</h2>
          <For each={section.rows}>{chord => <p class="help-line"><KeyHint keys={chord.keys}>{labels().get(chord.keys) ?? chord.what}</KeyHint></p>}</For>
        </section>}</For>
        <Show when={props.projectOpen ?? true}><section class="help-shelf" aria-label={copy.shelfKeys}>
        <h2>{copy.shelfKeys}</h2>
        <p><KeyHint keys={copy.previousNextKeys}>{copy.focusThePreviousNextShelfRow}</KeyHint></p>
        <p><KeyHint keys={copy.enter}>{copy.toggleTheFocusedShelfRowSelection}</KeyHint></p>
        <p><KeyHint keys={copy.rangeKeys}>{copy.selectARangeOfShelfRows}</KeyHint></p>
        <p><KeyHint keys={copy.esc}>{copy.deleteSelectedShelfRowsCancelSelection}</KeyHint></p>
        </section></Show>
        <div class="app-dialog-actions"><Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger></div>
      </Dialog.Content></Dialog.Positioner>
    </Dialog.Root>
  );
};
