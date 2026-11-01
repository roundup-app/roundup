import { Portal } from "solid-js/web";
import { splitProps, type JSX } from "solid-js";
import type { Chord } from "../keys/chords";
import { Tooltip } from "./Tooltip";

/** The props a control spreads: its own, and the Tooltip trigger's. */
export type TriggerProps = Omit<JSX.ButtonHTMLAttributes<HTMLElement>, "ref" | "children">;

const focusProps = (trigger: TriggerProps) => splitProps(trigger, ["onFocusIn", "onFocusOut", "aria-describedby"])[0];

/** Put the trigger on the smallest element owning the text. Pointer openings assert containment in development and tests. The second children argument carries focus handlers for an enclosing keyboard control. Keyboard focus needs no pointer. */
export const Tip = (props: {
  text?: string | undefined;
  content?: JSX.Element;
  ids?: { trigger?: string | undefined };
  cut?: () => boolean;
  class?: string;
  chord?: Chord | undefined;
  disabled?: boolean;
  placement?: "bottom" | "right-start" | undefined;
  children: (trigger: (extra?: TriggerProps) => TriggerProps, focus: Pick<TriggerProps, "onFocusIn" | "onFocusOut" | "aria-describedby">) => JSX.Element;
}) => (
  <Tooltip.Root ids={props.ids} disabled={props.disabled || (props.cut ? !props.cut() : false)} closeOnEscape={false} positioning={props.placement ? { strategy: "fixed", placement: props.placement } : { strategy: "fixed" }}>
    <Tooltip.Trigger asChild={(trigger) => props.children(trigger, focusProps(trigger()))} />
    <Portal>
      <Tooltip.Positioner style={{ "pointer-events": "none" }}>
        <Tooltip.Content class={props.class ?? (props.content !== undefined ? "ink-tip" : undefined)} chord={props.chord}>{props.content ?? props.text}</Tooltip.Content>
      </Tooltip.Positioner>
    </Portal>
  </Tooltip.Root>
);
