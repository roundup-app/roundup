import { For } from "solid-js";
import type { Choice } from "@contracts/project/Choice";
import { DEFAULT_LABEL } from "./choices";

/** One select of a Model or an Effort: `default` (`null`) first, then the Adapter's labels (U377, U378). */
const ChoiceSelect = (props: {
  label: string;
  choices: readonly Choice[];
  value: string | null;
  onChange: (value: string | null, select: HTMLSelectElement) => void;
}) => (
  <select
    class="choice-select"
    aria-label={props.label}
    onChange={(change) => props.onChange(change.currentTarget.value === "" ? null : change.currentTarget.value, change.currentTarget)}
  >
    <option value="" selected={props.value === null}>{DEFAULT_LABEL}</option>
    <For each={props.choices}>{(choice) => <option value={choice.id} selected={props.value === choice.id}>{choice.label}</option>}</For>
  </select>
);

/** The Model and Effort selects of one subject (a role, an Agent, the add), named `<subject> model` and `<subject> effort` (U86). */
export const ModelPair = (props: {
  subject: string;
  models: readonly Choice[];
  efforts: readonly Choice[];
  model: string | null;
  effort: string | null;
  onModel: (value: string | null, select: HTMLSelectElement) => void;
  onEffort: (value: string | null, select: HTMLSelectElement) => void;
}) => (
  <>
    <ChoiceSelect label={`${props.subject} model`} choices={props.models} value={props.model} onChange={props.onModel} />
    <ChoiceSelect label={`${props.subject} effort`} choices={props.efforts} value={props.effort} onChange={props.onEffort} />
  </>
);
