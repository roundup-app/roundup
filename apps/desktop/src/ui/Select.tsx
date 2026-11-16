import "./Field.css";
import { makeEventListener } from "@solid-primitives/event-listener";
import "./Select.css";
import { createFloatingControl } from "./Dialog";
import { createSelectController, Select as SelectRoot, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectLabel, SelectTrigger, SelectValue } from "@ui-sdk/solid/select";
import { createSignal, createUniqueId, For } from "solid-js";
import type { JSX } from "@solidjs/web";
import Check from "@lucide/solid/icons/check";
import ChevronDown from "@lucide/solid/icons/chevron-down";

export type SelectChoice = { value: string; label: string };

/** A labelled single-choice list over ui-sdk's Select; Escape in an open list closes only that list. */
export const Select = (props: {
  label: string;
  description?: string;
  choices: SelectChoice[];
  value: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}): JSX.Element => {
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const control = createFloatingControl({}, root);
  const controller = createSelectController<string>();
  const id = createUniqueId();

  // An Escape in the open list closes only it: stopping it at the window's capture phase keeps every enclosing dismiss layer, whichever registered first, from seeing it.
  makeEventListener(window, "keydown", (event) => {
    const target = event.target;

    if (event.key !== "Escape" || !control.open() || !(target instanceof Node) || !root()?.contains(target)) return;
    event.stopPropagation();
    controller.close();
  }, true);

  return <div class="app-select" ref={setRoot}>
    <SelectRoot items={props.choices} value={props.value} {...props.disabled === undefined ? {} : { disabled: props.disabled }} controller={controller}
      onValueChange={next => props.onValueChange(next ?? props.value)}
      open={control.open()} onOpenChange={open => control.change({ open })}>
      <SelectLabel class="app-select-label">{props.label}</SelectLabel>
      <SelectTrigger class="app-select-trigger" aria-label={props.label} aria-describedby={props.description ? `${id}-hint` : undefined}>
        <SelectValue />
        <ChevronDown aria-hidden="true" class="app-select-mark" size={16} />
      </SelectTrigger>
      {props.description && <span id={`${id}-hint`} class="app-select-hint">{props.description}</span>}
      <SelectContent class="app-select-list">
        <For each={props.choices}>{(choice) => <SelectItem value={choice.value} class="app-select-item">
          <SelectItemText>{choice.label}</SelectItemText>
          <SelectItemIndicator class="app-choice-check"><Check aria-hidden="true" size={16} /></SelectItemIndicator>
        </SelectItem>}</For>
      </SelectContent>
    </SelectRoot>
  </div>;
};
