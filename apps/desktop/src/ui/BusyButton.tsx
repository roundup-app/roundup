import "./BusyButton.css";
import { omit, Show } from "solid-js";
import type { ComponentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";

/** U170's button kinds; `null` for a button whose surface styles it. */
type Kind = "primary" | "quiet" | "add" | "row-action" | "icon" | null;

// No caller styles a button inline; Solid's spread `style` admits `undefined`, which ui-sdk's does not.
type Click = NonNullable<ComponentProps<typeof Button>["onClick"]>;

type Props = Omit<ComponentProps<typeof Button>, "render" | "children" | "type" | "style" | "onClick" | "focusableWhenDisabled" | "pendingAnnouncement"> & {
  kind: Kind;
  /** The label at rest. */
  children: JSX.Element;
  /** The label while the work runs: the verb in `-ing` form and `…`. */
  busyLabel: string;
  /** A returned promise keeps the button busy until it settles; Solid's bound form `[handler, data]` works too. */
  onClick?: Click | undefined;
  /** Work the button does not hold (a store's, a form submit's) keeps it busy as well. */
  busy?: boolean | undefined;
  type?: "button" | "submit" | undefined;
};

/** U170 Busy: ui-sdk's Button is pending while the promise its click returns runs (`aria-busy`, presses refused, focus kept); this shows the busy label and its mark in the idle label's place, so the button keeps its width. The button's name stays its idle label; ui-sdk announces the busy label. At rest the busy label is only an attribute, out of the button's text. A disabled button stays focusable with `aria-disabled` (U171). */
export const BusyButton = (props: Props): JSX.Element => {
  const rest = omit(props, "kind", "children", "busyLabel", "busy", "disabled", "type", "onClick");

  return <Button
    {...rest}
    type={props.type ?? "button"}
    data-button={props.kind ?? undefined}
    disabled={props.disabled === true || props.busy === true}
    focusableWhenDisabled
    pendingAnnouncement={props.busyLabel}
    onClick={(event, details) => {
      const click = props.onClick;

      if (!click) return undefined;

      return "0" in click ? click[0](click[1], event, details) : click(event, details);
    }}
    render={(attrs, state) => {
      const busy = () => state.pending || props.busy === true;

      return <button {...attrs} data-busy-button="" data-busy-label={props.busyLabel} aria-busy={busy() ? "true" : undefined}>
        <span class="busy-idle">{props.children}</span>
        <Show when={busy()}><span class="busy-work" aria-hidden="true"><span class="busy-mark" />{props.busyLabel}</span></Show>
      </button>;
    }}
  />;
};
