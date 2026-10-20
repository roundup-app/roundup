import "./Checkbox.css";
import { Checkbox as ArkCheckbox } from "@ark-ui/solid/checkbox";
import type { JSX } from "solid-js";

/** A labelled on/off choice over Ark's Checkbox; Space toggles it and the caller owns the value. */
export const Checkbox = (props: { class?: string; checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void; children: JSX.Element }): JSX.Element => (
  <ArkCheckbox.Root class={`app-checkbox ${props.class ?? ""}`} checked={props.checked} disabled={props.disabled}
    onCheckedChange={(details) => props.onCheckedChange(details.checked === true)}>
    <ArkCheckbox.Control class="app-checkbox-box" />
    <ArkCheckbox.Label class="app-checkbox-label">{props.children}</ArkCheckbox.Label>
    <ArkCheckbox.HiddenInput asChild={(input) => <input {...input()} style="" />} />
  </ArkCheckbox.Root>
);
