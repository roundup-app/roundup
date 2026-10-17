import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { copy } from "../copy";
import { KindGlyph } from "../ink/KindGlyph";
import { Combobox } from "../ui/Combobox";
import { useConnectedProject } from "../state/connectedProject";
import { registerKeys } from "../keys/registry";
import { chordsFor, SWITCHER_CLOSE, SWITCHER_TAKE } from "../keys/chords";
import { REVEAL_BUBBLE } from "../bubbles/places";
import { entriesOf, matching } from "./entries";
import type { Entry } from "./entries";
import "./styles.css";

const focusTarget = (): void => {
  const target = document.querySelector<HTMLElement>('.thread[data-mode="thread"] .thread-composer textarea:not(:disabled)')
    ?? document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]");

  target?.focus();
};

/** U529, U530: `⌘K` opens a filter field over the centre pane listing every row by name; `⏎` selects the highlighted one as a click does, `⇧⏎` also takes control of an Agent. `onFailure` gets a failed Takeover's message; `onOpen` runs as it opens, so an overlaid Shelf can close and leave no scrim over it. */
export const Switcher = (props: { onFailure: (message: string | null) => void; onOpen: () => void }) => {
  const { rail, takeover, daemonExit } = useConnectedProject();
  const [open, setOpen] = createSignal(false);
  const [text, setText] = createSignal("");
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let panel: HTMLElement | undefined;
  let returnTo: Element | null = null;

  const entries = createMemo(() => entriesOf(rail.nodes, rail.terminals()));
  const shown = createMemo(() => matching(entries(), text()));

  createEffect(() => {
    const list = shown();

    if (!list.some((entry) => entry.value === highlighted())) setHighlighted(list[0]?.value ?? null);
  });

  const close = (restore: boolean): void => {
    setOpen(false);

    if (restore && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
  };

  const choose = (entry: Entry, take: boolean): void => {
    close(false);
    props.onFailure(null);

    if (entry.terminal !== undefined) {
      rail.select(entry.terminal.owner);
      window.dispatchEvent(new CustomEvent(REVEAL_BUBBLE, { detail: entry.terminal.id }));

      return;
    }

    const node = entry.node!;

    rail.select(node.id);
    focusTarget();

    if (!take || node.kind !== "agent") return;

    void takeover.begin(node.id).then((failure) => {
      if (failure !== null) props.onFailure(failure);
      else focusTarget();
    });
  };

  const chooseValue = (value: string | null, take: boolean): void => {
    const entry = shown().find((candidate) => candidate.value === value);

    if (entry) choose(entry, take);
  };

  const chooseHighlighted = (take: boolean): void => chooseValue(highlighted(), take);

  const show = (): void => {
    returnTo = document.activeElement;
    props.onOpen();
    setText("");
    setOpen(true);
  };

  registerKeys({ kind: "app" }, [{
    chords: chordsFor("⌘K"),
    when: () => daemonExit() === null && document.querySelector(".spawn-prompt-field") === null,
    run: (press) => { if (!press.repeat) show(); },
  }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [
    { chords: chordsFor("⌘K"), run: (press) => { if (!press.repeat) close(true); } },
    { chords: SWITCHER_CLOSE, run: () => close(true) },
    { chords: SWITCHER_TAKE, run: () => chooseHighlighted(true) },
  ]);

  return (
    <Show when={open()}>
      <section class="switcher" ref={(element) => { panel = element; queueMicrotask(() => element.querySelector("input")?.focus()); }}>
        <Combobox.Root items={shown()} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onInput={setText}
          onSelect={(value) => chooseValue(value, false)}
          label={copy.switcherLabel} placeholder={copy.switcherPlaceholder} empty={copy.noMatch}
          row={(item) => {
            const entry = shown().find((candidate) => candidate.value === item.value)!;

            return <>
              <Show when={entry.node?.status} fallback={<span class="switcher-mark" />}>{(status) => <KindGlyph kind={status().kind} decorative />}</Show>
              <span class="switcher-name">{entry.label}</span>
              <Show when={entry.owner}><span class="switcher-owner">{entry.owner}</span></Show>
            </>;
          }} />
      </section>
    </Show>
  );
};
