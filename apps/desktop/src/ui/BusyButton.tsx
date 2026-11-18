import "./BusyButton.css";
import { omit, Show } from "solid-js";
import type { ComponentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button } from "@ui-sdk/solid/button";
import { tipName, type UniversalIcon } from "./universalIcons";
import { Tip, type OwnTriggerProps, type Trigger } from "./Tip";

/** U170's button kinds; `null` for a button whose surface styles it. */
type Kind = "primary" | "quiet" | "add" | "row-action" | "icon" | null;

// No caller styles a button inline; Solid's spread `style` admits `undefined`, which ui-sdk's does not.
type Click = NonNullable<ComponentProps<typeof Button>["onClick"]>;

type Props = Omit<ComponentProps<typeof Button>, "render" | "children" | "type" | "style" | "onClick" | "focusableWhenDisabled" | "pendingAnnouncement"> & {
  kind: Kind;
  /** The label at rest; an icon for an icon button, which its `aria-label` names. */
  children: JSX.Element;
  /** The label while the work runs: the verb in `-ing` form and `…`. */
  busyLabel: string;
  /** A returned promise keeps the button busy until it settles; Solid's bound form `[handler, data]` works too. */
  onClick?: Click | undefined;
  /** Work the button does not hold (a store's, a form submit's) keeps it busy as well. */
  busy?: boolean | undefined;
  type?: "button" | "submit" | undefined;
  /** U7413a: the role of a universal icon, which shows no name tooltip. */
  icon?: UniversalIcon | undefined;
};

const Busy = (props: Props & { tip?: Trigger }): JSX.Element => {
  const rest = omit(props, "kind", "children", "busyLabel", "busy", "disabled", "type", "onClick", "tip", "icon");
  // U7310e: an icon button shows only the busy mark in its icon's place.
  const icon = () => props.kind === "icon";

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

      // SAFETY: ui-sdk's attributes for this button; the Tooltip trigger runs its handlers after them and keeps both refs.
      return <button {...(props.tip ? props.tip(attrs as OwnTriggerProps) : attrs)} data-busy-button="" data-busy-label={icon() ? undefined : props.busyLabel} aria-busy={busy() ? "true" : undefined}>
        <span class="busy-idle">{props.children}</span>
        <Show when={busy()}><span class="busy-work" aria-hidden="true"><span class="busy-mark" /><Show when={!icon()}>{props.busyLabel}</Show></span></Show>
      </button>;
    }}
  />;
};

/** U170 Busy: ui-sdk's Button is pending while the promise its click returns runs (`aria-busy`, presses refused, focus kept); this shows the busy label and its mark in the idle label's place, so the button keeps its width. The button's name stays its idle label; ui-sdk announces the busy label. At rest the busy label is only an attribute, out of the button's text. A disabled button stays focusable with `aria-disabled` (U171). An icon button's shared Tooltip shows its name (U7310e). */
export const BusyButton = (props: Props): JSX.Element => <Show when={props.kind === "icon"} fallback={<Busy {...props} />}>
  <Tip text={tipName(props.icon, undefined, props["aria-label"] || undefined)} disabled={props.icon !== undefined}>{trigger => <Busy {...props} tip={trigger} />}</Tip>
</Show>;
