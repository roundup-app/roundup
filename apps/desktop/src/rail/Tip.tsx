import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";
import { Tooltip } from "../ui/Tooltip";

/** The props a control spreads: its own, and the Tooltip trigger's. */
export type TriggerProps = JSX.ButtonHTMLAttributes<HTMLButtonElement>;

/** The shared Tooltip on one control: `children` spreads the trigger props onto the element it renders, so hover and keyboard focus both open `text`. Only a text the control does not show in full needs it; an icon-only button is `IconButton`. */
export const Tip = (props: { text: string; children: (trigger: (extra?: TriggerProps) => TriggerProps) => JSX.Element }) => (
  <Tooltip.Root closeOnEscape={false} positioning={{ strategy: "fixed" }}>
    <Tooltip.Trigger asChild={(trigger) => props.children(trigger)} />
    <Portal>
      <Tooltip.Positioner>
        <Tooltip.Content>{props.text}</Tooltip.Content>
      </Tooltip.Positioner>
    </Portal>
  </Tooltip.Root>
);
