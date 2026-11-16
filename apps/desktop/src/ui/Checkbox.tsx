import "./Field.css";
import "./Checkbox.css";
import { Checkbox as UiCheckbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox";
import Check from "@lucide/solid/icons/check";
import Minus from "@lucide/solid/icons/minus";
import { onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";

/** A labelled on/off choice over ui-sdk's Checkbox; Space toggles it and the caller owns the value. */
export const Checkbox = (props: { class?: string; controlRef?: (element: HTMLButtonElement) => void; onKeyDown?: JSX.EventHandlerUnion<HTMLButtonElement, KeyboardEvent>; onClickCapture?: (event: MouseEvent) => void; checked: boolean | "indeterminate"; invalid?: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void; children: JSX.Element }): JSX.Element => {
  let control: HTMLButtonElement | undefined;

  onSettled(() => {
    const click = props.onClickCapture;
    const element = control;

    if (!click || !element) return;
    // listener-owner: onSettled refuses onCleanup, so the cleanup it returns removes this.
    element.addEventListener("click", click, true);

    return () => element.removeEventListener("click", click, true);
  });

  return (
    <label class={`app-checkbox ${props.class ?? ""}`} data-disabled={props.disabled ? "" : undefined} data-invalid={props.invalid ? "" : undefined}>
      <UiCheckbox class="app-checkbox-box" ref={element => { control = element; props.controlRef?.(element); }} checked={props.checked} disabled={props.disabled ?? false} data-invalid={props.invalid ? "" : undefined} aria-invalid={props.invalid ? "true" : undefined}
        onKeyDown={props.onKeyDown} onCheckedChange={checked => props.onCheckedChange(checked === true)}>
        <CheckboxIndicator>{state => state.indeterminate ? <Minus aria-hidden="true" /> : <Check aria-hidden="true" />}</CheckboxIndicator>
      </UiCheckbox>
      <span class="app-checkbox-label">{props.children}</span>
    </label>
  );
};
