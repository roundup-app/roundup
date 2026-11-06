import { createSignal, Show, splitProps, type JSX } from "solid-js";
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

/** U6249e: how a failure line lets the user recover. `dismiss` is required: ReservedLine draws the Dismiss button from it (or, with `dismissIn: "menu"`, leaves the button to the row's context menu, whose item calls the same function). `recover` is the verb to try again, drawn as a button labelled Retry unless it names its own label. */
export type Recovery = {
  dismiss: () => void;
  recover?: { run: () => void; label?: string | undefined } | undefined;
  dismissIn?: "menu" | undefined;
};

/** A line that is not a failure: status text, with optional actions. */
type StatusProps = Shared & { message?: never; children?: JSX.Element; action?: JSX.Element };

/** U6249e: a failure line states how the user dismisses it and, when there is something to try again, how. Failures outrank status text. `action` holds extra controls only. */
type FailureProps = Shared & { message: string | null | false | undefined; children?: JSX.Element; action?: JSX.Element } & Recovery;

type Props = StatusProps | FailureProps;

/** Every prop either form may carry, for reading both through one name. */
type Loose = { message?: string | null | false; children?: JSX.Element; action?: JSX.Element; dismiss?: (() => void) | undefined; recover?: Recovery["recover"]; dismissIn?: Recovery["dismissIn"] };

/** The Retry and Dismiss controls a failure line draws from its `Recovery`. */
export const RecoveryButtons = (props: { dismiss?: (() => void) | undefined; recover?: Recovery["recover"]; dismissIn?: Recovery["dismissIn"] }) => <>
  <Show when={props.recover}>{recover => <button type="button" data-button="quiet" onClick={() => recover().run()}>{recover().label ?? copy.retry}</button>}</Show>
  <Show when={props.dismiss && props.dismissIn !== "menu" ? props.dismiss : undefined}>{dismiss => <button type="button" data-button="quiet" data-dismiss-failure onMouseDown={event => event.preventDefault()} onClick={() => dismiss()()}>{copy.dismissFailure}</button>}</Show>
</>;

/** A failure that goes away with the state that caused it still has a dismissal: the user hides the current message, and a different message shows again. */
export const dismissable = (message: () => string | null | false | undefined) => {
  const [hidden, setHidden] = createSignal<string | null>(null);

  return { message: () => message() && message() !== hidden() ? message() : null, dismiss: () => setHidden(message() || null) };
};

/** U3807: callers keep this place mounted and change only its message and actions. */
export const ReservedLine = (props: Props) => {
  // SAFETY: both forms are assignable to Shared & Loose; Loose only widens the form-specific keys to optional.
  const [local, rest] = splitProps(props as Shared & Loose, ["message", "status", "content", "overlay", "children", "action", "dismiss", "recover", "dismissIn", "class"]);

  // U3807 explicitly requires the whole message as a title on its reserved place.
  // oxlint-disable-next-line anti-slop/no-tooltip-bypass
  return <div title={local.message || local.status || undefined} role={!local.message && (local.status || props["aria-live"] !== undefined) ? "status" : undefined} {...rest} class={`reserved-line${local.class ? ` ${local.class}` : ""}`} data-overlay={local.overlay ? "true" : undefined} data-empty={local.message || local.status || (props["aria-live"] !== undefined && local.content) ? undefined : "true"}>
    <div class="reserved-content">
      <Show when={local.message} fallback={<span class="reserved-status">{local.status || props["aria-live"] !== undefined ? local.content ?? (local.status || null) : null}</span>}>
        {message => <ErrorLine message={message()} content={local.content} />}
      </Show>
      <Show when={local.message || local.status}><div class="reserved-actions">{local.children}{local.action}<Show when={local.message}><RecoveryButtons recover={local.recover} dismiss={local.dismiss} dismissIn={local.dismissIn} /></Show></div></Show>
    </div>
  </div>;
};

/** Solid's ErrorBoundary fallback keeps the same presentation as an ordinary failure. */
export const failureLine = (failure: Error, reset: () => void) => <ReservedLine message={failure.message} dismiss={reset} recover={{ run: reset }} />;
