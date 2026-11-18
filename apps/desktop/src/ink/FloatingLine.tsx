import { Show, omit } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorLine } from "./ErrorLine";
import { RecoveryButtons, type Dismissible } from "./recovery";
import "./floatingLine.css";

type Shared = Omit<JSX.HTMLAttributes<HTMLDivElement>, "role" | "children"> & { action?: JSX.Element; children?: JSX.Element };

/** U7314h: a status with its controls (U7211a's Resume line) or a failure with its Dismiss (`.todo-undo`) that floats over the edge of the surface holding it, out of flow. It is mounted only while it holds, so it takes no place before or after. */
export const FloatingLine = (props: Shared & ({ status: string | null | false | undefined; message?: never } | (Partial<Dismissible> & { message: string | null | false | undefined; status?: never }))) => {
  // SAFETY: the union only separates a status from a failure; both are read here through the same optional names.
  const local = props as Shared & { status?: string | null | false; message?: string | null | false; dismiss?: () => void; recover?: Dismissible["recover"] };
  const rest = omit(local, "status", "message", "dismiss", "recover", "action", "children", "class");

  return <Show when={local.message || local.status}>{text => <div {...rest} class={`floating-line${local.class ? ` ${local.class}` : ""}`} role={local.message ? undefined : "status"}>
    <Show when={local.message} fallback={<span class="floating-status">{text()}</span>}>{message => <ErrorLine message={message()} />}</Show>
    <div class="floating-actions">{local.children}{local.action}<Show when={local.message}><RecoveryButtons recover={local.recover} dismiss={local.dismiss} /></Show></div>
  </div>}</Show>;
};
