import "./Checkbox.css";
import "./Switch.css";
import { Switch as ArkSwitch } from "@ark-ui/solid/switch";
import type { JSX } from "solid-js";

/** A labelled switch over Ark; the caller supplies the acknowledged value. */
export const Switch = (props: { class?: string; checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void; children: JSX.Element }): JSX.Element => (
  <ArkSwitch.Root class={`app-checkbox app-switch ${props.class ?? ""}`} checked={props.checked} disabled={props.disabled}
    onCheckedChange={(details) => props.onCheckedChange(details.checked)}>
    <ArkSwitch.Control class="app-checkbox-box" />
    <ArkSwitch.Label class="app-checkbox-label">{props.children}</ArkSwitch.Label>
    <ArkSwitch.HiddenInput onClick={(event) => {
      const input = event.currentTarget;

      // Native clicks toggle before Ark notifies the caller; keep the input on the acknowledged value too.
      queueMicrotask(() => { input.checked = props.checked; });
    }} asChild={(input) => <input {...input()} role="switch" aria-checked={props.checked} style="" />} />
  </ArkSwitch.Root>
);
