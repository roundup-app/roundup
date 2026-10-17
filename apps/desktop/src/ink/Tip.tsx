import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";
import { Tooltip } from "../ui";

type Trigger = () => Omit<JSX.HTMLAttributes<HTMLElement>, "ref" | "children">;

/** U501: the full, unchanged `content` of a truncated or multiline element in the shared Tooltip, on hover and keyboard focus. `children` receives the trigger's props and returns the focusable element. */
export const Tip = (props: { content: string; children: (trigger: Trigger) => JSX.Element }) => (
  <Tooltip.Root closeOnEscape={false} positioning={{ strategy: "fixed" }}>
    <Tooltip.Trigger asChild={(trigger) => props.children(trigger)} />
    <Portal><Tooltip.Positioner><Tooltip.Content class="ink-tip">{props.content}</Tooltip.Content></Tooltip.Positioner></Portal>
  </Tooltip.Root>
);
