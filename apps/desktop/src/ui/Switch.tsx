import "./Field.css";
import "./Switch.css";
import { trackFocusVisible } from "@zag-js/focus-visible";
import { Switch as ArkSwitch } from "@ark-ui/solid/switch";
import { createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from "solid-js";

/** A labelled switch over Ark; the caller supplies the acknowledged value. */
export const Switch = (props: { class?: string; checked: boolean; disabled?: boolean; invalid?: boolean; description?: string; onCheckedChange: (checked: boolean) => void; children: JSX.Element }): JSX.Element => {
  const descriptionId = createUniqueId();
  const [keyboardFocus, setKeyboardFocus] = createSignal(false);

  onMount(() => onCleanup(trackFocusVisible({ onChange: details => setKeyboardFocus(details.isFocusVisible) })));

  return (
    <ArkSwitch.Root data-keyboard-focus={keyboardFocus() ? "" : undefined} class={`app-switch ${props.class ?? ""}`} checked={props.checked} disabled={props.disabled} invalid={props.invalid}
      onCheckedChange={(details) => props.onCheckedChange(details.checked)}>
      <ArkSwitch.Control class="app-switch-track"><ArkSwitch.Thumb class="app-switch-thumb" /></ArkSwitch.Control>
      <ArkSwitch.Label class="app-switch-label">{props.children}</ArkSwitch.Label>
      <Show when={props.description}><span id={descriptionId} hidden>{props.description}</span></Show>
      <ArkSwitch.HiddenInput onClick={(event) => {
        const input = event.currentTarget;

        // Native clicks toggle before Ark notifies the caller; keep the input on the acknowledged value too.
        queueMicrotask(() => { input.checked = props.checked; });
      }} asChild={(input) => <input {...input()} role="switch" aria-describedby={props.description ? descriptionId : undefined} aria-checked={props.checked} style="" />} />
    </ArkSwitch.Root>
  );
};
