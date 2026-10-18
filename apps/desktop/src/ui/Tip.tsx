import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";
import type { Chord } from "../keys/chords";
import { Tooltip } from "./Tooltip";

/** The props a control spreads: its own, and the Tooltip trigger's. */
export type TriggerProps = Omit<JSX.ButtonHTMLAttributes<HTMLElement>, "ref" | "children">;

/** Put the trigger on the smallest element owning the text. `anchor` names an intentional wider owner (U521); pointer openings assert containment in development and tests. Keyboard focus needs no pointer. */
export const Tip = (props: {
  text?: string | undefined;
  content?: JSX.Element;
  anchor?: () => HTMLElement | undefined;
  ids?: { trigger?: string | undefined };
  cut?: () => boolean;
  class?: string;
  chord?: Chord | undefined;
  disabled?: boolean;
  children: (trigger: (extra?: TriggerProps) => TriggerProps) => JSX.Element;
}) => (
  <Tooltip.Root ids={props.ids} anchor={props.anchor} disabled={props.disabled || (props.cut ? !props.cut() : false)} closeOnEscape={false} positioning={{ strategy: "fixed" }}>
    <Tooltip.Trigger asChild={(trigger) => props.children(trigger)} />
    <Portal>
      <Tooltip.Positioner>
        <Tooltip.Content class={props.class ?? (props.content !== undefined ? "ink-tip" : undefined)} chord={props.chord}>{props.content ?? props.text}</Tooltip.Content>
      </Tooltip.Positioner>
    </Portal>
  </Tooltip.Root>
);
