import { createReducedMotion } from "../app/reducedMotion";
import { pressFeedback } from "./pressFeedback";
import { createSignal, onMount, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { runChecks } from "../testing/checks";
import { Menu } from "./Menu";
import { Select } from "./Select";
import { Disclosure } from "./Disclosure";
import { Checkbox } from "./Checkbox";
import { Switch } from "./Switch";
import { Tabs } from "./Tabs";
import { For } from "solid-js";
import { RadioGroup } from "./RadioGroup";
import { SegmentGroup } from "./SegmentGroup";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

function ChoiceControls() {
  const reduced = createReducedMotion(query => window.matchMedia(query));
  onMount(() => onCleanup(pressFeedback(document, reduced)));
  const [select, setSelect] = createSignal("first");
  const [calls, setCalls] = createSignal(0);
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
    <For each={["Button", "Checkbox", "Switch", "Tab"]}>{(name) => {
      const [calls, setCalls] = createSignal(0);
      const [checked, setChecked] = createSignal(false);
      const change = (value: boolean) => { setChecked(value); setCalls(count => count + 1); };

      return <section data-control={name}>
        {name === "Button" && <button type="button" data-button="quiet" onClick={() => setCalls(count => count + 1)}>Button</button>}
        {name === "Checkbox" && <Checkbox checked={checked()} onCheckedChange={change}>Checkbox</Checkbox>}
        {name === "Switch" && <Switch checked={checked()} onCheckedChange={change}>Switch</Switch>}
        {name === "Tab" && <Tabs.Root activationMode="manual" value={checked() ? "second" : "first"} onValueChange={() => change(true)}>
          <Tabs.List><Tabs.Trigger value="first">First tab</Tabs.Trigger><Tabs.Trigger value="second">Second tab</Tabs.Trigger></Tabs.List>
          <Tabs.Content value="first">First panel</Tabs.Content><Tabs.Content value="second">Second panel</Tabs.Content>
        </Tabs.Root>}
        <output aria-label={`${name} changes`}>{calls()}</output>
      </section>;
    }}</For>
    <section class="app-dialog" aria-label="Filled controls">
      <button type="button" data-button="primary" onClick={() => setCalls(count => count + 1)}>Save</button>
      <button type="button" data-button="quiet" onClick={() => setCalls(count => count + 1)}>Cancel</button>
    </section>
    <Menu.Root onSelect={() => setCalls(count => count + 1)}>
      <Menu.Trigger data-button="quiet">Actions</Menu.Trigger>
      <Menu.Positioner><Menu.Content><Menu.Item value="one">Run action</Menu.Item></Menu.Content></Menu.Positioner>
    </Menu.Root>
    <Select label="Select choice" value={select()} onValueChange={setSelect} choices={choices} />
    <Disclosure label="Details">Expanded content</Disclosure>
    <a href="#native-link">Native link</a>
    <details><summary>Native summary</summary>Native content</details>
    <output aria-label="Action calls">{calls()}</output>
    <button type="button" data-away data-button="quiet">Away</button>
  </main>;
}

Object.assign(window, { __checks: runChecks });

render(ChoiceControls, document.getElementById("root")!);
