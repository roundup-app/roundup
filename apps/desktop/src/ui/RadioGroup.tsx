import "./Field.css";
import "./RadioGroup.css";
import { Radio, RadioGroup as UiRadioGroup, RadioIndicator } from "@ui-sdk/solid/radio";
import { createUniqueId, For } from "solid-js";
import type { JSX } from "@solidjs/web";

export type RadioChoice<V extends string> = { value: V; label: string };

/** A labelled one-of-many choice over ui-sdk's RadioGroup; arrows move and select, Tab leaves the group, and the caller owns the value. */
export const RadioGroup = <V extends string>(props: {
  class?: string;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  choices: readonly RadioChoice<V>[];
  value: V;
  onValueChange: (value: V) => void;
}): JSX.Element => {
  const label = createUniqueId();

  return (
  <UiRadioGroup aria-labelledby={label} aria-invalid={props.invalid ? "true" : undefined} class={`app-radio-group ${props.class ?? ""}`} disabled={props.disabled ?? false} value={props.value} onValueChange={(value) => props.onValueChange(props.choices.find((choice) => choice.value === value)?.value ?? props.value)}>
    <span id={label} class="app-radio-label">{props.label}</span>
    <For each={props.choices}>{(choice) => (
      <label class="app-radio" data-choice={choice.value} data-disabled={props.disabled ? "" : undefined} data-invalid={props.invalid ? "" : undefined}>
        <Radio value={choice.value} class="app-radio-mark" data-invalid={props.invalid ? "" : undefined}><RadioIndicator class="app-radio-dot" /></Radio>
        <span class="app-radio-text">{choice.label}</span>
      </label>
    )}</For>
  </UiRadioGroup>
  );
};
