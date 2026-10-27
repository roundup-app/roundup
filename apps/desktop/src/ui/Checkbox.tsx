import "./Field.css";
import "./Checkbox.css";
import { Checkbox as ArkCheckbox } from "@ark-ui/solid/checkbox";
import Check from "lucide-solid/icons/check";
import Minus from "lucide-solid/icons/minus";
import { createEffect, type JSX } from "solid-js";

/** A labelled on/off choice over Ark's Checkbox; Space toggles it and the caller owns the value. */
export const Checkbox = (props: { class?: string; checked: boolean | "indeterminate"; invalid?: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void; children: JSX.Element }): JSX.Element => (
  <ArkCheckbox.Root class={`app-checkbox ${props.class ?? ""}`} checked={props.checked} disabled={props.disabled} invalid={props.invalid}
    onCheckedChange={(details) => props.onCheckedChange(details.checked === true)}>
    <ArkCheckbox.Control class="app-checkbox-box"><ArkCheckbox.Indicator><Check aria-hidden="true" /></ArkCheckbox.Indicator><ArkCheckbox.Indicator indeterminate><Minus aria-hidden="true" /></ArkCheckbox.Indicator></ArkCheckbox.Control>
    <ArkCheckbox.Label class="app-checkbox-label">{props.children}</ArkCheckbox.Label>
    <ArkCheckbox.HiddenInput asChild={(input) => <input {...input()} ref={element => { createEffect(() => { element.indeterminate = props.checked === "indeterminate"; }); }} style="" />} />
  </ArkCheckbox.Root>
);
