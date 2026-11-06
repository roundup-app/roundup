import { Show } from "solid-js";
import type { Status } from "@contracts/Status";
import { createCut } from "./Tip";
import { Tip } from "../ui/Tip";
import { copy } from "./copy";
import { DISMISS_ONLY, ROW_ACTION, DismissButton, type Recovery } from "./ReservedLine";
import "./failureLine.css";

/** The failure text with its cut Tip, for a cause that is not an Agent Status. */
export const Line = (props: { label: string; class?: string | undefined }) => {
  const [ref, cut] = createCut(() => props.label);

  return (
    <Tip text={props.label} cut={cut}>
      {trigger => <span {...trigger()} ref={ref} class={`failure-line ${props.class ?? ""}`} data-failure="">{props.label}</span>}
    </Tip>
  );
};

/** U5151a: the Adapter's cause and next action for an Agent whose last turn failed, for a surface that lists the Agent in a row it cannot hold a control in (a picker, a mention); the row's `ReservedLine` shows it as status text. */
export const errorCause = (status: Status | null | undefined, dismissed: boolean | undefined) =>
  status?.kind === "error" ? (dismissed ? copy.dismissedFailure(status.label) : status.label) : null;

/** U6249e: the failure notice for an Agent's last turn, which states what the user can do about it and how it goes away. */
export const FailureLine = (props: { status: Status | null | undefined; dismissed?: boolean; class?: string } & Recovery) => (
  <Show when={errorCause(props.status, props.dismissed)}>{label => <>
    <Line label={label()} class={`${props.class ?? ""} ${props.dismissed ? "dismissed" : ""}`} />
    {props.action === DISMISS_ONLY || props.action === ROW_ACTION ? null : props.action}
    <Show when={"onDismiss" in props ? props.onDismiss : undefined}>{dismiss => <DismissButton onDismiss={dismiss()} />}</Show>
  </>}</Show>
);

/** U5151c: the Kind an individual Agent presents; a dismissed failure no longer reads as an error. */
export const shownKind = (status: Status | null | undefined, dismissed: boolean): Status["kind"] =>
  status?.kind === "error" && dismissed ? "idle" : status?.kind ?? "idle";
