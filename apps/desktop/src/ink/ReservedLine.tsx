import { Show, splitProps, type Accessor, type JSX } from "solid-js";
import { ErrorLine } from "./ErrorLine";
import { copy } from "./copy";
import "./styles.css";

type Shared = Omit<JSX.HTMLAttributes<HTMLDivElement>, "role" | "children"> & {
  status?: string | null | false | undefined;
  /** Rich text keeps its canonical message for the title and announcement. */
  content?: JSX.Element;
  /** An edge the containing surface reserves over its content, out of flow. */
  overlay?: boolean;
};

/** `action` for a failure with nothing to retry: the Dismiss button `onDismiss` draws is the whole recovery. */
export const DISMISS_ONLY = "dismiss-only";

/** U6249e: how the user lets go of a failure: a dismissal ReservedLine draws, or the signal whose change clears it. */
type Dismissal = { onDismiss: () => void } | { clearedBy: Accessor<unknown> };

/** An `action` is a control to run, or, when only dismissing is possible, the Dismiss button itself. */
export type Recovery = ({ action: JSX.Element } & Dismissal) | { action: typeof DISMISS_ONLY; onDismiss: () => void };

/** A line that is not a failure: status text, with optional actions. */
type StatusProps = Shared & { message?: never; children?: JSX.Element };

/** U6249e: a failure line states what the user can do (`action`) and how it goes away. Failures outrank status text. */
type FailureProps = Shared & { message: string | null | false | undefined } & Recovery;

type Props = StatusProps | FailureProps;

/** Every prop either form may carry, for reading both through one name. */
type Loose = { message?: string | null | false; children?: JSX.Element; action?: JSX.Element; onDismiss?: () => void; clearedBy?: Accessor<unknown> };

/** The standard control that lets the user dismiss a failure line. */
export const DismissButton = (props: { onDismiss: () => void }) => <button type="button" data-button="quiet" onClick={() => props.onDismiss()}>{copy.dismissFailure}</button>;

/** U3807: callers keep this place mounted and change only its message and actions. */
export const ReservedLine = (props: Props) => {
  // SAFETY: both forms are assignable to Shared & Loose; Loose only widens the form-specific keys to optional.
  const [local, rest] = splitProps(props as Shared & Loose, ["message", "status", "content", "overlay", "children", "action", "onDismiss", "clearedBy", "class"]);

  // U3807 explicitly requires the whole message as a title on its reserved place.
  // oxlint-disable-next-line anti-slop/no-tooltip-bypass
  return <div title={local.message || local.status || undefined} role={!local.message && (local.status || props["aria-live"] !== undefined) ? "status" : undefined} {...rest} class={`reserved-line${local.class ? ` ${local.class}` : ""}`} data-overlay={local.overlay ? "true" : undefined} data-empty={local.message || local.status || (props["aria-live"] !== undefined && local.content) ? undefined : "true"}>
    <div class="reserved-content">
      <Show when={local.message} fallback={<span class="reserved-status">{local.status || props["aria-live"] !== undefined ? local.content ?? (local.status || null) : null}</span>}>
        {message => <ErrorLine message={message()} content={local.content} />}
      </Show>
      <Show when={local.message || local.status}><div class="reserved-actions">{local.children}{local.action === DISMISS_ONLY ? null : local.action}<Show when={local.message ? local.onDismiss : undefined}>{dismiss => <DismissButton onDismiss={dismiss()} />}</Show></div></Show>
    </div>
  </div>;
};

/** Solid's ErrorBoundary fallback keeps the same presentation as an ordinary failure. */
export const failureLine = (failure: Error, reset: () => void) => <ReservedLine message={failure.message} action={<button type="button" data-button="quiet" onClick={reset}>{copy.retry}</button>} clearedBy={() => failure} />;
