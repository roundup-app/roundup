import { Show } from "solid-js";
import { ErrorLine } from "./ErrorLine";
import { RecoveryButtons, type Blocked } from "./ReservedLine";
import "./failureLine.css";

/** U7314e: a failure the screen cannot go on without. It is that screen's own view, not a message beside it: no Dismiss, no toast, and no place before or after. */
export const BlockedFailure = (props: Pick<Blocked, "recover"> & { message: string | null | false | undefined }) => (
  <Show when={props.message}>{message => <div class="mounted-line">
    <ErrorLine message={message()} />
    <RecoveryButtons recover={props.recover} />
  </div>}</Show>
);
