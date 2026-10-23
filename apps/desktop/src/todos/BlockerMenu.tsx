import { createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import type { Todo } from "@contracts/todo/Todo";
import { copy } from "../copy";
import { registerKeys } from "../keys/registry";
import { Icon } from "../ink/Icon";
import { Combobox } from "../ui/Combobox";
import { Popover } from "../ui/Popover";
import "./blockerMenu.styles.css";

/** U3728: `+ Blocker` opens a floating, filterable menu of the other Todos; Escape closes it and returns focus to the button. */
export const BlockerMenu = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  others: readonly Todo[];
  buttonRef: (button: HTMLButtonElement) => void;
  onPick: (id: number) => void;
}) => {
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>(null);
  let button: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const shown = createMemo(() => {
    const needle = query().trim().toLowerCase();

    return props.others.filter((other) => `#${other.id} ${other.title}`.toLowerCase().includes(needle)).map((other) => ({ value: String(other.id), label: other.title }));
  });

  const highlighted = () => shown().some((item) => item.value === highlight()) ? highlight() : shown()[0]?.value ?? null;

  const close = () => {
    props.onOpenChange(false);
    setQuery("");
    setHighlight(null);
  };

  registerKeys({ kind: "layer", element: () => menu, active: () => props.open, modal: false }, [{
    chords: ["Escape"],
    run: () => { close(); button?.focus(); },
  }]);

  return <Popover.Root closeOnInteractOutside={false} open={props.open && props.others.length > 0} onOpenChange={({ open }) => { if (!open) close(); }} positioning={{ placement: "bottom-start", strategy: "fixed" }}>
    {/* oxlint-disable-next-line anti-slop/no-tooltip-bypass -- U171 requires a focusable disabled button to expose its reason as title. */}
    <Popover.Trigger asChild={(attributes) => <button {...attributes()} data-button="add" type="button" aria-disabled={props.others.length === 0 || undefined} title={props.others.length === 0 ? copy.noOtherBlockers : undefined} class="word todo-blocker-trigger"
      ref={(element) => { button = element; props.buttonRef(element); }}
      onClick={() => { if (props.open) close(); else if (props.others.length > 0) props.onOpenChange(true); }}>
      <Icon name="plus" />{copy.blockerWord}</button>} />
    <Portal><Popover.Positioner><Popover.Content class="todo-blocker-menu">
      <div ref={(element) => { menu = element; }}>
      <Combobox.Root items={shown()} inputValue={query()} onInput={setQuery} highlightedValue={highlighted()} onHighlightChange={setHighlight}
        onSelect={(value) => { close(); props.onPick(Number(value)); }}
        label={copy.blockerWord.trim()} placeholder={copy.blockerPlaceholder} empty={copy.noMatch}
        row={(item) => <><span class="todo-blocker-title">{item.label}</span><span class="mono light">#{item.value}</span></>} />
      </div>
    </Popover.Content></Popover.Positioner></Portal>
  </Popover.Root>;
};
