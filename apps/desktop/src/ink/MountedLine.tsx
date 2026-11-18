import { Show } from "solid-js";
import { ErrorLine } from "./ErrorLine";
import { RecoveryButtons, type Dismissible } from "./ReservedLine";
import "./failureLine.css";

/** U7314a: a failure a dialog shows for its own form. The Toast region sits under a dialog's backdrop, so the failure shows in the dialog from an element mounted only while it holds; it is announced once (U80) and takes no place before or after. */
export const DialogFailure = (props: Dismissible & { message: string | null | false | undefined }) => (
  <Show when={props.message}>{message => <div class="mounted-line">
    <ErrorLine message={message()} />
    <RecoveryButtons recover={props.recover} dismiss={props.dismiss} />
  </div>}</Show>
);

/** U7314a: a status or notice that reports no failure, mounted only while it holds. */
export const StatusNote = (props: { text: string | null | false | undefined; label?: string }) => (
  <Show when={props.text}>{text => <p class="ink mounted-line" role="status" aria-label={props.label}>{text()}</p>}</Show>
);
