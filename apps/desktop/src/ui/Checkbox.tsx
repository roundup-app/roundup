import "./Checkbox.css";
import { Checkbox as ArkCheckbox } from "@ark-ui/solid/checkbox";
import Check from "lucide-solid/icons/check";
import type { JSX } from "solid-js";

/** A labelled on/off choice over Ark's Checkbox. */
export const Checkbox = (props: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }): JSX.Element =>
  <ArkCheckbox.Root class="app-checkbox" checked={props.checked} onCheckedChange={(details) => props.onCheckedChange(details.checked === true)}>
    <ArkCheckbox.Control class="app-checkbox-control">
      <ArkCheckbox.Indicator><Check size={12} aria-hidden="true" /></ArkCheckbox.Indicator>
    </ArkCheckbox.Control>
    <ArkCheckbox.Label>{props.label}</ArkCheckbox.Label>
    <ArkCheckbox.HiddenInput style={{ margin: 0 }} />
  </ArkCheckbox.Root>;
