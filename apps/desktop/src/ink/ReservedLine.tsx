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
  return <div title={local.message || undefined} role={(!local.message && local.status) || props["aria-live"] !== undefined ? "status" : undefined} {...rest} class={`reserved-line${local.class ? ` ${local.class}` : ""}`} data-overlay={local.overlay ? "true" : undefined} data-empty={local.message || local.status ? undefined : "true"}>
    <div class="reserved-content" role={local.message ? "alert" : undefined} aria-label={local.message || undefined}>
      {/* U3807 requires the whole status in its title; error text keeps its Ark tooltip too. */}
      {/* oxlint-disable-next-line anti-slop/no-tooltip-bypass */}
      <Show when={local.message} fallback={<span class="reserved-status" title={local.status || undefined}>{local.status ? local.content ?? local.status : null}</span>}>
        {message => <ErrorLine message={message()} content={local.content} announce={false} />}
      </Show>
      <div class="reserved-actions" hidden={!local.message && !local.status}>{local.children}</div>
    </div>
  </div>;
};

/** Solid's ErrorBoundary fallback keeps the same presentation as an ordinary failure. */
export const failureLine = (failure: Error) => <ReservedLine message={failure.message} />;
