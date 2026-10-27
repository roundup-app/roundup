import "./Field.css";
import "./RadioGroup.css";
import { RadioGroup as ArkRadioGroup } from "@ark-ui/solid/radio-group";
import { createUniqueId, For, type JSX } from "solid-js";

export type RadioChoice<V extends string> = { value: V; label: string };

/** A labelled one-of-many choice over Ark's RadioGroup; arrows move and select, Tab leaves the group, and the caller owns the value. */
export const RadioGroup = <V extends string>(props: {
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  choices: readonly RadioChoice<V>[];
  value: V;
  onValueChange: (value: V) => void;
}): JSX.Element => {
  const label = createUniqueId();

  return (
  <ArkRadioGroup.Root ids={{ label }} class="app-radio-group" disabled={props.disabled} invalid={props.invalid} value={props.value} onValueChange={(details) => props.onValueChange(props.choices.find((choice) => choice.value === details.value)?.value ?? props.value)}>
    <ArkRadioGroup.Label class="app-radio-label">{props.label}</ArkRadioGroup.Label>
    <For each={props.choices}>{(choice) => (
      <ArkRadioGroup.Item value={choice.value} class="app-radio">
        <ArkRadioGroup.ItemControl class="app-radio-mark" />
        <ArkRadioGroup.ItemText>{choice.label}</ArkRadioGroup.ItemText>
        <ArkRadioGroup.ItemHiddenInput asChild={(input) => <input {...input()} style="" />} />
      </ArkRadioGroup.Item>
    )}</For>
  </ArkRadioGroup.Root>
  );
};
