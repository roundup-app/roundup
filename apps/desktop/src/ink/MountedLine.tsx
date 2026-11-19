import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorLine } from "./ErrorLine";
import { RecoveryButtons, type Blocked, type Dismissible } from "./recovery";
import "./failureLine.css";

/** U7314a: a failure a dialog shows for its own form. The Toast region sits under a dialog's backdrop, so the failure shows in the dialog from an element mounted only while it holds; it is announced once (U80) and takes no place before or after. */
export const DialogFailure = (props: Dismissible & { message: string | null | false | undefined; action?: JSX.Element; notice?: boolean | undefined }) => (
  <Show when={props.message}>{message => <div class="mounted-line">
    <ErrorLine message={message()} notice={props.notice} />
    {props.action}
    <RecoveryButtons recover={props.recover} dismiss={props.dismiss} />
  </div>}</Show>
);

/** U7314a: a status or notice that reports no failure, mounted only while it holds. */
export const StatusNote = (props: { text: string | null | false | undefined; label?: string; icon?: JSX.Element; busy?: boolean; class?: string; live?: "off" | "polite"; content?: JSX.Element }) => (
  <Show when={props.text}>{text => <p aria-live={props.live} aria-atomic={props.live === "polite" ? "true" : undefined} class={`ink mounted-line${props.class ? ` ${props.class}` : ""}`} role="status" aria-label={props.label} aria-busy={props.busy ? "true" : undefined}>{props.icon}{props.content ?? text()}</p>}</Show>
);

/** U7314a: a status that holds controls, mounted only while it holds. */
export const MountedStatus = (props: { when: boolean; class: string; children: JSX.Element }) => (
  <Show when={props.when}><div class={`mounted-line ${props.class}`} role="status">{props.children}</div></Show>
);

/** U7314c: a status that continues the line of text before it (a marker after a count), mounted only while it holds. */
export const InlineStatus = (props: { text: string | null | false | undefined }) => (
  <Show when={props.text}>{text => <span role="status">{text()}</span>}</Show>
);

/** U7314e, U7314g: a failure the screen cannot go on without (a startup gate, an error boundary's fallback). It is that screen's own view, not a message beside it: no Dismiss, no toast, and no place before or after. */
export const BlockedFailure = (props: Pick<Blocked, "recover"> & { message: string | null | false | undefined; content?: JSX.Element }) => (
  <Show when={props.message}>{message => <div class="mounted-line">
    <ErrorLine message={message()} content={props.content} />
    <RecoveryButtons recover={props.recover} />
  </div>}</Show>
);
