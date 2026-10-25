import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RadioGroup } from "./RadioGroup";
import { SegmentGroup } from "./SegmentGroup";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

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
    <button type="button" data-button="quiet">Away</button>
  </main>;
}

render(ChoiceControls, document.getElementById("root")!);
