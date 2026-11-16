import { createSignal, For } from "solid-js";
import { render } from "@solidjs/web";
import { Field } from "./Field";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
import { Select } from "./Select";
import { RadioGroup } from "./RadioGroup";
import { Combobox } from "./Combobox";
import { pressFeedback } from "./pressFeedback";
import { runChecks } from "../testing/checks";
import { ReservedLine } from "../ink/ReservedLine";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "../terminal/fontSize";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

const Fixture = () => {
  pressFeedback(document);
  const choices = [{value:"a",label:"First"},{value:"b",label:"Second"}];
  Object.assign(window, { __checks: runChecks });

  return <main style={{"padding":"var(--space-5)","display":"grid","grid-template-columns":"repeat(3, minmax(0, 1fr))","gap":"var(--space-6)"}}>
    <For each={["Enabled", "Disabled", "Invalid"]}>{state => {
      const [checked, setChecked] = createSignal(false);
      const [value, setValue] = createSignal("a");
      const disabled = state === "Disabled";
      const invalid = state === "Invalid";

      return <section style={{"display":"flex","flex-direction":"column","gap":"var(--space-4)"}}>
        <h2 style={{"margin":"0","font-size":"var(--text-title)"}}>{state}</h2>
        <Field.Root disabled={disabled} invalid={invalid}><Field.Label>Project name</Field.Label><Field.Input type="text" placeholder="Enter a name" />
          <Field.HelperText>A name for your work</Field.HelperText><Field.ErrorText>Enter a project name.</Field.ErrorText></Field.Root>
        <Field.Root disabled={disabled} invalid={invalid}><Field.Label>Instructions</Field.Label><Field.Textarea rows={2} placeholder="Describe the work" /><Field.ErrorText>Enter instructions.</Field.ErrorText></Field.Root>
        <Field.Root disabled={disabled} invalid={invalid}><Select label="Choice" choices={choices} value={value()} onValueChange={setValue} /><Field.ErrorText>Choose an available option.</Field.ErrorText></Field.Root>
        <Checkbox checked={checked()} disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Include completed</Checkbox>
        <Checkbox checked="indeterminate" disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Some selected</Checkbox>
        <Checkbox checked disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>All selected</Checkbox>
        <Switch checked disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Updates enabled</Switch>
        <Switch checked={checked()} disabled={disabled} invalid={invalid} onCheckedChange={setChecked}>Automatic updates</Switch>
        <RadioGroup label="Mode" choices={choices} value={value()} disabled={disabled} invalid={invalid} onValueChange={setValue} />
        <Field.Root disabled={disabled} invalid={invalid}><Field.Label>Font size</Field.Label><Field.Input type="number" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} value="12" /></Field.Root>
        <Field.Root disabled={disabled} invalid={invalid}><Field.Label>Model</Field.Label><Combobox.Picker label="Model" items={choices} value={value()} onSelect={setValue} /><Field.ErrorText>Choose an available model.</Field.ErrorText></Field.Root>
        <ReservedLine status={invalid && "Correct the marked choices."} />
      </section>;
    }}</For>
  </main>;
};

render(Fixture, document.getElementById("root")!);
