import { Show } from "solid-js";
import type { Status } from "@contracts/Status";
import "./failureLine.css";

/** U5151a: the Adapter's cause and next action for an Agent whose last turn failed, shown as text on every surface that presents the error. */
export const FailureLine = (props: { status: Status | null | undefined; class?: string }) => (
  <Show when={props.status?.kind === "error" ? props.status.label : null}>{label => <span class={`failure-line ${props.class ?? ""}`} data-failure="">{label()}</span>}</Show>
);
