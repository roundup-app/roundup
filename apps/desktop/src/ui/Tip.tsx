import { merge, omit } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { Chord } from "../keys/chords";
import { Tooltip } from "./Tooltip";

/** The props a control spreads: its own, and the Tooltip trigger's. */
export type TriggerProps = Omit<JSX.ButtonHTMLAttributes<HTMLElement>, "ref" | "children">;

/** What a control adds to the trigger: its own props, and a `ref` the trigger keeps beside its own. */
export type OwnTriggerProps = TriggerProps & { ref?: JSX.Ref<HTMLElement> };

export type Trigger = (own?: OwnTriggerProps) => TriggerProps;

type Handler = JSX.EventHandlerUnion<HTMLElement, Event>;

type Fired = Parameters<JSX.EventHandler<HTMLElement, Event>>[0];

const FOCUS_PROPS = new Set<PropertyKey>(["onFocusIn", "onFocusOut", "aria-describedby"]);

const focusProps = (trigger: TriggerProps) => omit(trigger, key => !FOCUS_PROPS.has(key));

const run = (handler: Handler, event: Fired) => {
  if ("0" in handler) handler[0](handler[1], event);
  else handler(event);
};

/** The control's own handlers run before the Tooltip trigger's, so a press it handles can still close the tooltip. */
const withOwn = (trigger: OwnTriggerProps, own: OwnTriggerProps): TriggerProps => {
  const theirs = new Map<string, Handler>(Object.entries(trigger));

  const chained: Record<`on${string}`, (event: Fired) => void> = Object.fromEntries(Object.entries(own).flatMap(([key, handler]) => {
    const other = theirs.get(key);

    return /^on[A-Z]/.test(key) && other ? [[key, (event: Fired) => { run(handler, event); run(other, event); }]] : [];
  }));

  return merge(trigger, own, chained, { ref: trigger.ref && own.ref ? [trigger.ref, own.ref] : trigger.ref ?? own.ref });
};

/** Put the trigger on the smallest element owning the text. Pointer openings assert containment in development and tests. The second children argument carries focus handlers for an enclosing keyboard control. Keyboard focus needs no pointer. */
export const Tip = (props: {
  text?: string | undefined;
  content?: JSX.Element;
  cut?: () => boolean;
  class?: string;
  chord?: Chord | undefined;
  disabled?: boolean;
  children: (trigger: Trigger, focus: Pick<TriggerProps, "onFocusIn" | "onFocusOut" | "aria-describedby">) => JSX.Element;
}) => (
  <Tooltip.Root disabled={props.disabled || (props.cut ? !props.cut() : false)} delay={200}>
    <Tooltip.Trigger render={rendered => {
      const trigger: OwnTriggerProps = omit(rendered, "class", "style", "children");

      return props.children(own => own ? withOwn(trigger, own) : trigger, merge(focusProps(trigger), { onFocusIn: Tooltip.useEnclosingFocusIn() }));
    }} />
    <Tooltip.Content side="right" align="start" class={props.class ?? (props.content !== undefined ? "ink-tip" : undefined)} chord={props.chord}>{props.content ?? props.text}</Tooltip.Content>
  </Tooltip.Root>
);
