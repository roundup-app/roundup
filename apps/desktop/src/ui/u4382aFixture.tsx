import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import { Field } from "./Field";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
import { Select } from "./Select";
import { RadioGroup } from "./RadioGroup";
import { NumberInput } from "./NumberInput";
import { Combobox } from "./Combobox";
import { runChecks } from "../testing/checks";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

const Fixture = () => {
  const choices = [{value:"a",label:"First"},{value:"b",label:"Second"}];
  Object.assign(window, { __checks: runChecks });

  return <main style="padding: var(--space-5); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-6)">
    <For each={["Enabled", "Disabled", "Invalid"]}>{state => {
      const [checked, setChecked] = createSignal(false);
      const [value, setValue] = createSignal("a");
      const disabled = state === "Disabled";
      const invalid = state === "Invalid";

      return <section style="display: flex; flex-direction: column; gap: var(--space-4)">
        <h2>{state}</h2>
        <Field.Root disabled={disabled} invalid={invalid}><Field.Label>Project name</Field.Label><Field.Input placeholder="Enter a name" />
          <Field.HelperText>A name for your work</Field.HelperText><Field.ErrorText>Enter a project name.</Field.ErrorText></Field.Root>
        <Field.Root disabled={disabled} invalid={invalid}><Field.Label>Instructions</Field.Label><Field.Textarea rows={2} placeholder="Describe the work" /><Field.ErrorText>Enter instructions.</Field.ErrorText></Field.Root>
        <Field.Root disabled={disabled} invalid={invalid}><Select label="Choice" choices={choices} value={value()} onValueChange={setValue} /><Field.ErrorText>Choose an available option.</Field.ErrorText></Field.Root>
        <Checkbox checked={checked()} disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Include completed</Checkbox>
        <Checkbox checked="indeterminate" disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Some selected</Checkbox>
        <Checkbox checked disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>All selected</Checkbox>
        <Switch checked disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Updates enabled</Switch>
        <Switch checked={checked()} disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Automatic updates</Switch>
        <RadioGroup label="Mode" choices={choices} value={value()} disabled={disabled} invalid={invalid} onValueChange={setValue} />
        <NumberInput.Root disabled={disabled} invalid={invalid} defaultValue="12"><NumberInput.Label>Font size</NumberInput.Label><NumberInput.Input /></NumberInput.Root>
        <Field.Root disabled={disabled} invalid={invalid}><Combobox.Picker label="Model" items={choices} value={value()} onSelect={setValue} /><Field.ErrorText>Choose an available model.</Field.ErrorText></Field.Root>
        {invalid && <p role="alert">Correct the marked choices.</p>}
      </section>;
    }}</For>
  </main>;
};

render(Fixture, document.getElementById("root")!);
