import { KeyHint } from "./KeyHint";
import { copy } from "../copy";
import { createSignal, For, Show } from "solid-js";
import { CHORDS, HELP_KEYS, LEADER } from "./chords";
import { hintPlaceAt } from "./HintLine";
import { Portal } from "solid-js/web";
import { registerKeys } from "./registry";
import { Dialog } from "../ui/Dialog";

const bubbleScopes = new Map(Object.entries(copy.helpBubbleScope));

const rowScopes = new Map(Object.entries(copy.helpRowScope));

const sections = () => [
  { title: copy.helpScope.app, rows: CHORDS.filter(row => !row.inRail && !row.onAgent && !row.inSwitcher && !row.inTerminals && !row.inShelf) },
  { title: copy.helpScope.leader, rows: LEADER.map(row => ({ ...row, keys: `${copy.leaderChord} ${row.keys}`, what: bubbleScopes.get(row.keys) ?? row.what })) },
  { title: copy.helpScope.terminals, rows: CHORDS.filter(row => row.inTerminals) },
  { title: copy.helpScope.switcher, rows: CHORDS.filter(row => row.inSwitcher) },
  { title: copy.helpScope.rail, rows: CHORDS.filter(row => row.inRail) },
  { title: copy.helpScope.agent, rows: CHORDS.filter(row => row.onAgent) },
  { title: copy.helpScope.shelf, rows: CHORDS.filter(row => row.inShelf && !row.inTriage && row.keys !== "T").map(row => ({ ...row, what: rowScopes.get(row.keys) ?? row.what })) },
  { title: copy.helpScope.todos, rows: CHORDS.filter(row => row.inShelf && row.keys === "T") },
  { title: copy.helpScope.triage, rows: CHORDS.filter(row => row.inTriage) },
];

/** The panel `?` opens over the centre pane, one line per chord. It holds focus while open; Esc, `?` or a click outside closes it and focus returns to where it was. */
export const Help = () => {
  const [open, setOpen] = createSignal(false);
  let panel: HTMLElement | undefined;
  let returnTo: Element | null = null;
  let underlying: Element | null = null;
  const [origin, setOrigin] = createSignal<ReturnType<typeof hintPlaceAt>>(null);

  const originSection = () => {
    const at = origin();
    const shelf = at === "todos" || at === "pads" || at === "shelf";

    const title = at === "triage" ? copy.helpScope.triage : shelf ? copy.helpScope.shelf
      : at === "bubble" ? copy.helpScope.terminals : at === "rail" ? copy.helpScope.rail
      : at === "agent" ? copy.helpScope.agent : at === "switcher" ? copy.helpScope.switcher
      : at === "pad" ? copy.pad : at === "drawer" ? copy.drawer : copy.helpScope.app;

    const rows = CHORDS.filter(row => {
      if (at === "triage") return row.inTriage;

      if (shelf) return row.inShelf && !row.inTriage;

      if (at === "switcher") return row.inSwitcher || row.what === copy.close;

      if (at === "rail" && (row.inRail || row.onAgent)) return true;

      if (at === "agent" && (row.onAgent || row.inTerminals)) return true;

      if (at === "bubble" && row.inTerminals) return true;

      if ((at === "pad" || at === "drawer") && row.what === copy.close) return true;

      return !row.inRail && !row.onAgent && !row.inSwitcher && !row.inTerminals && !row.inShelf;
    }).map(row => ({ ...row, what: shelf ? rowScopes.get(row.keys) ?? row.what : row.what }));

    if (at === "switcher") rows.unshift({ ...CHORDS.find(row => row.what === copy.todoLift)!, what: copy.hintOpen });

    // U480's component-navigation exception: these are existing TreeView, Combobox and panel-header keys.
    const navigation = at === "rail" ? [
      { keys: copy.previousNextKeys, what: copy.helpMoveFocus },
      { keys: copy.helpBranchKeys, what: copy.helpBranches },
      { keys: copy.renameChord, what: copy.rename },
    ] : at === "switcher" ? [{ keys: copy.previousNextKeys, what: copy.helpMoveFocus }]
      : at === "bubble" ? [{ keys: copy.helpPanelArrowKeys, what: copy.helpPanelMove }, { keys: copy.helpPanelResizeKeys, what: copy.helpPanelResize }] : [];

    return { title, rows: [...rows, ...navigation], shelf };
  };

  const show = (): void => {
    returnTo = document.activeElement;
    underlying = returnTo?.closest(".switcher") ?? null;
    underlying?.setAttribute("data-help-open", "");
    setOrigin(hintPlaceAt(returnTo));
    setOpen(true);
  };

  const close = (): void => {
    setOpen(false);
    underlying?.removeAttribute("data-help-open");

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };

  registerKeys({ kind: "layer", element: () => document.activeElement?.closest<HTMLElement>(".switcher, .drawer") ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined),
    active: () => !open() && hintPlaceAt(document.activeElement) !== null, modal: false },
    [{ chords: HELP_KEYS, when: press => press.target instanceof Element && hintPlaceAt(press.target) !== null, run: show }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [
    { chords: [...HELP_KEYS, "Escape"], run: close },
  ]);

  return (
    <Show when={open()}>
    <Portal>
    <Dialog.Root open onOpenChange={({ open }) => { if (!open) close(); }}
      initialFocusEl={() => panel ?? null}
      finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}
      onEscapeKeyDown={(event) => event.stopImmediatePropagation()}>
      <Dialog.Positioner class="help-positioner" popover={"showPopover" in HTMLElement.prototype ? "manual" : undefined} ref={element => queueMicrotask(() => { if (element.isConnected && element.showPopover) element.showPopover(); })}>
      <Dialog.Content class="help" data-origin={origin()} aria-label={copy.help} ref={(element) => { panel = element; queueMicrotask(() => element.isConnected && element.focus({ preventScroll: true })); }}>
        <section class="help-origin" data-origin={origin()}>
          <h2>{originSection().title}</h2>
          <For each={originSection().rows}>{row => <p class="help-line" data-help-keys={row.keys}><KeyHint keys={row.keys}>{row.what}</KeyHint></p>}</For>
          <Show when={originSection().shelf}>
            <p class="help-line"><KeyHint keys={copy.previousNextKeys}>{copy.focusThePreviousNextShelfRow}</KeyHint></p>
            <p class="help-line"><KeyHint keys={copy.enter}>{copy.toggleTheFocusedShelfRowSelection}</KeyHint></p>
            <p class="help-line"><KeyHint keys={copy.rangeKeys}>{copy.selectARangeOfShelfRows}</KeyHint></p>
            <p class="help-line"><KeyHint keys={copy.esc}>{copy.deleteSelectedShelfRowsCancelSelection}</KeyHint></p>
          </Show>
        </section>
        <For each={sections()}>{section => <section class="help-section">
          <h2>{section.title}</h2>
          <For each={section.rows}>{chord => <p class="help-line"><KeyHint keys={chord.keys}>{chord.what}</KeyHint></p>}</For>
        </section>}</For>
        <section class="help-shelf" aria-label={copy.shelfKeys}>
        <h2>{copy.shelfKeys}</h2>
        <p><KeyHint keys={copy.previousNextKeys}>{copy.focusThePreviousNextShelfRow}</KeyHint></p>
        <p><KeyHint keys={copy.enter}>{copy.toggleTheFocusedShelfRowSelection}</KeyHint></p>
        <p><KeyHint keys={copy.rangeKeys}>{copy.selectARangeOfShelfRows}</KeyHint></p>
        <p><KeyHint keys={copy.esc}>{copy.deleteSelectedShelfRowsCancelSelection}</KeyHint></p>
        </section>
      </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
    </Portal>
    </Show>
  );
};
