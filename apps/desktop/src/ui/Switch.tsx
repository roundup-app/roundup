import "./Field.css";
import "./Switch.css";
import { Switch as UiSwitch, SwitchThumb } from "@ui-sdk/solid/switch";
import { createUniqueId, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

/** A labelled switch over ui-sdk; the caller supplies the acknowledged value. */
export const Switch = (props: { class?: string; checked: boolean; disabled?: boolean; invalid?: boolean; description?: string; onCheckedChange: (checked: boolean) => void; children: JSX.Element }): JSX.Element => {
  const descriptionId = createUniqueId();

  return (
    <label class={`app-switch ${props.class ?? ""}`} data-disabled={props.disabled ? "" : undefined} data-invalid={props.invalid ? "" : undefined}>
      <UiSwitch class="app-switch-track" checked={props.checked} disabled={props.disabled ?? false} data-invalid={props.invalid ? "" : undefined} aria-invalid={props.invalid ? "true" : undefined} aria-describedby={props.description ? descriptionId : undefined}
        onCheckedChange={checked => props.onCheckedChange(checked)}>
        <SwitchThumb class="app-switch-thumb" />
      </UiSwitch>
      <span class="app-switch-label">{props.children}</span>
      <Show when={props.description}><span id={descriptionId} hidden>{props.description}</span></Show>
    </label>
  );
};
