import { Show } from "solid-js";
import type { Status } from "@contracts/Status";
import { createCut } from "./Tip";
import { Tip } from "../ui/Tip";
import { copy } from "./copy";
import "./failureLine.css";

const Line = (props: { label: string; class?: string | undefined }) => {
  const [ref, cut] = createCut(() => props.label);

  return (
    <Tip text={props.label} cut={cut}>
      {trigger => <span {...trigger()} ref={ref} class={`failure-line ${props.class ?? ""}`} data-failure="">{props.label}</span>}
    </Tip>
  );
};

/** U5151a: the Adapter's cause and next action for an Agent whose last turn failed, shown as text on every surface that presents the error. */
export const FailureLine = (props: { status: Status | null | undefined; dismissed?: boolean; class?: string }) => (
  <Show when={props.status?.kind === "error" ? (props.dismissed ? copy.dismissedFailure(props.status.label) : props.status.label) : null}>{label => <Line label={label()} class={`${props.class ?? ""} ${props.dismissed ? "dismissed" : ""}`} />}</Show>
);
