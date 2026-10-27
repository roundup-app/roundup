import { Field } from "@ark-ui/solid/field";
import { Fieldset } from "@ark-ui/solid/fieldset";
import { DatePicker } from "@ark-ui/solid/date-picker";
import { NumberInput } from "@ark-ui/solid/number-input";
import { Checkbox as ArkCheckbox } from "@ark-ui/solid/checkbox";
import { createUniqueId, For, Show, type JSX } from "solid-js";

/** Ark owns each field's accessible label and control relationship. */
const Text = (props: { label: string; value: string; onInput: (value: string) => void; area?: boolean; placeholder?: string }) =>
  <Field.Root class="reaction-field"><Field.Label class="reaction-label">{props.label}</Field.Label>
    <Show when={props.area} fallback={<Field.Input type="text" value={props.value} placeholder={props.placeholder} spellcheck={false} autocorrect="off" autocapitalize="off" onInput={event => props.onInput(event.currentTarget.value)} />}>
      <Field.Textarea rows={3} value={props.value} spellcheck={false} autocorrect="off" autocapitalize="off" onInput={event => props.onInput(event.currentTarget.value)} />
    </Show>
  </Field.Root>;

/** Semantic groups share Ark's legend relationship. */
const Group = (props: { label: string; children: JSX.Element }) =>
  <Fieldset.Root class="reaction-group"><Fieldset.Legend class="reaction-legend">{props.label}</Fieldset.Legend>{props.children}</Fieldset.Root>;

/** Ark supplies spinbutton parsing, bounds and arrow-key increments. */
const Numeric = (props: { label: string; value: string; onChange: (value: string) => void }) =>
  <NumberInput.Root class="reaction-field" min={1} value={props.value} onValueChange={details => props.onChange(details.value)}>
    <NumberInput.Label class="reaction-label">{props.label}</NumberInput.Label><NumberInput.Input type="text" />
  </NumberInput.Root>;

/** Ark's date input commits an explicit civil date; the caller retains unfinished text. */
const CivilDate = (props: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) =>
  <DatePicker.Root class="reaction-field" locale="en-CA" format={value => value.toString()} onValueChange={details => props.onChange(details.value[0]?.toString() ?? "")}>
    <DatePicker.Label class="reaction-label">{props.label}</DatePicker.Label>
    <DatePicker.Control><DatePicker.Input type="text" value={props.value} placeholder={props.placeholder} onInput={event => props.onChange(event.currentTarget.value)} /></DatePicker.Control>
  </DatePicker.Root>;

/** Ark's CheckboxGroup owns the selected identities and labelled group. */
const Checks = (props: { label: string; values: string[]; items: { value: string; label: string }[]; onChange: (values: string[]) => void }) =>
{
  const label = createUniqueId();

  return <div class="reaction-field"><span id={label} class="reaction-label">{props.label}</span>
  <ArkCheckbox.Group class="reaction-agents" aria-labelledby={label} value={() => props.values} onValueChange={props.onChange}>
    <For each={props.items}>{item => <ArkCheckbox.Root class="app-checkbox" value={item.value}>
      <ArkCheckbox.Control class="app-checkbox-box" /><ArkCheckbox.Label class="app-checkbox-label">{item.label}</ArkCheckbox.Label>
      <ArkCheckbox.HiddenInput asChild={(input) => <input {...input()} style="" />} />
    </ArkCheckbox.Root>}</For>
  </ArkCheckbox.Group></div>;
};

export const Form = { Text, Group, Number: Numeric, Date: CivilDate, Checks };
