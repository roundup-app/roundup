import "./BusyButton.css";
import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";

type Kind = "primary" | "quiet" | "add";

/** U170 Busy: a button of one kind that shows its work while the promise its click returns is pending. `aria-busy="true"`, the busy label beside an indeterminate mark, clicks ignored; it stays focusable and in place. `busy` lets a caller whose work outlives the button (a shared store) hold the state. */
export const BusyButton = (props: {
  kind: Kind;
  /** The label at rest. */
  children: JSX.Element;
  /** The label while the work runs: the verb in `-ing` form and `…`. */
  busyLabel: string;
  onClick: () => Promise<void> | void;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  class?: string | undefined;
}): JSX.Element => {
  const [pending, setPending] = createSignal(false);
  const busy = () => pending() || props.busy === true;

  const click = () => {
    if (busy()) return;

    const work = props.onClick();

    if (!work) return;

    setPending(true);
    // The caller shows a failure; the button only returns to its idle label.
    void work.then(() => setPending(false), () => setPending(false));
  };

  return (
    <button
      type="button"
      disabled={props.disabled}
      class={props.class}
      data-button={props.kind}
      data-busy-button=""
      aria-busy={busy() ? "true" : undefined}
      onClick={click}
    >
      <span class="busy-idle" data-shown={busy() ? "false" : "true"} aria-hidden={busy() ? "true" : undefined}>{props.children}</span>
      <span class="busy-work" data-shown={busy() ? "true" : "false"} aria-hidden={busy() ? undefined : "true"}>
        <span class="busy-mark" aria-hidden="true" />
        {props.busyLabel}
      </span>
    </button>
  );
};
