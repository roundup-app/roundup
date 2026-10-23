import { Show, splitProps, type JSX } from "solid-js";
import { ErrorLine } from "./ErrorLine";
import "./styles.css";

type Props = Omit<JSX.HTMLAttributes<HTMLDivElement>, "role" | "children"> & {
  /** Failures outrank status text. Empty content still reserves exactly one line. */
  message?: string | null | false | undefined;
  status?: string | null | false | undefined;
  /** Rich text keeps its canonical message for the title and announcement. */
  content?: JSX.Element;
  /** An edge the containing surface reserves over its content, out of flow. */
  overlay?: boolean;
  /** Retry or recovery actions; shown only while a message is present. */
  children?: JSX.Element;
};

/** U3807: callers keep this place mounted and change only its message and actions. */
export const ReservedLine = (props: Props) => {
  const [local, rest] = splitProps(props, ["message", "status", "content", "overlay", "children", "class"]);

  // U3807 explicitly requires the whole message as a title on its reserved place.
  // oxlint-disable-next-line anti-slop/no-tooltip-bypass
  return <div title={local.message || local.status || undefined} role={!local.message && (local.status || props["aria-live"] !== undefined) ? "status" : undefined} {...rest} class={`reserved-line${local.class ? ` ${local.class}` : ""}`} data-overlay={local.overlay ? "true" : undefined} data-empty={local.message || local.status || (props["aria-live"] !== undefined && local.content) ? undefined : "true"}>
    <div class="reserved-content">
      <Show when={local.message} fallback={<span class="reserved-status">{local.status || props["aria-live"] !== undefined ? local.content ?? (local.status || null) : null}</span>}>
        {message => <ErrorLine message={message()} content={local.content} />}
      </Show>
      <Show when={local.message || local.status}><div class="reserved-actions">{local.children}</div></Show>
    </div>
  </div>;
};

/** Solid's ErrorBoundary fallback keeps the same presentation as an ordinary failure. */
export const failureLine = (failure: Error) => <ReservedLine message={failure.message} />;
