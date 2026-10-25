import { trackPress } from "./press";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
import { Toggle } from "./Toggle";
import { Tabs } from "./Tabs";
import { For } from "solid-js";
import { RadioGroup } from "./RadioGroup";
import { SegmentGroup } from "./SegmentGroup";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

trackPress(document);

function ChoiceControls() {
  const [radio, setRadio] = createSignal("first");
  const [segment, setSegment] = createSignal("first");
  const [radioCalls, setRadioCalls] = createSignal(0);
  const [segmentCalls, setSegmentCalls] = createSignal(0);
  const choices = [{ value: "first", label: "First" }, { value: "second", label: "Second" }];

  return <main>
    <RadioGroup label="Radio choice" choices={choices} value={radio()} onValueChange={(value) => { setRadio(value); setRadioCalls((count) => count + 1); }} />
    <output aria-label="Radio changes">{radioCalls()}</output>
    <SegmentGroup label="Segment choice" segments={choices} value={segment()} onValueChange={(value) => { setSegment(value); setSegmentCalls((count) => count + 1); }} />
    <output aria-label="Segment changes">{segmentCalls()}</output>
    <For each={["Button", "Checkbox", "Switch", "Toggle", "Tab"]}>{(name) => {
      const [calls, setCalls] = createSignal(0);
      const [checked, setChecked] = createSignal(false);
      const change = (value: boolean) => { setChecked(value); setCalls(count => count + 1); };

      return <section data-control={name}>
        {name === "Button" && <button type="button" data-button="quiet" onClick={() => setCalls(count => count + 1)}>Button</button>}
        {name === "Checkbox" && <Checkbox checked={checked()} onCheckedChange={change}>Checkbox</Checkbox>}
        {name === "Switch" && <Switch checked={checked()} onCheckedChange={change}>Switch</Switch>}
        {name === "Toggle" && <Toggle pressed={checked()} onPressedChange={change}>Toggle</Toggle>}
        {name === "Tab" && <Tabs.Root activationMode="manual" value={checked() ? "second" : "first"} onValueChange={() => change(true)}>
          <Tabs.List><Tabs.Trigger value="first">First tab</Tabs.Trigger><Tabs.Trigger value="second">Second tab</Tabs.Trigger></Tabs.List>
          <Tabs.Content value="first">First panel</Tabs.Content><Tabs.Content value="second">Second panel</Tabs.Content>
        </Tabs.Root>}
        <output aria-label={`${name} changes`}>{calls()}</output>
      </section>;
    }}</For>
    <button type="button" data-away data-button="quiet">Away</button>
  </main>;
}

render(ChoiceControls, document.getElementById("root")!);
