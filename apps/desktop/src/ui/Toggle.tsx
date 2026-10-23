import { Toggle as ArkToggle } from "@ark-ui/solid/toggle";
import type { JSX } from "solid-js";

/** A button that is pressed or not, over Ark's Toggle; the caller owns the state and what a press does. */
export const Toggle = (props: { class?: string; pressed: boolean; disabled?: boolean; onPressedChange: (pressed: boolean) => void; children: JSX.Element }): JSX.Element => (
  <ArkToggle.Root data-button="quiet" class={`word ${props.class ?? ""}`} pressed={props.pressed} disabled={props.disabled}
    onPressedChange={props.onPressedChange}>
    {props.children}
  </ArkToggle.Root>
);
