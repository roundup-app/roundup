import { Show, type JSX } from "solid-js";
import type { Status } from "@contracts/Status";
import { elapsed } from "../shelf/Age";
import { useDisplayNow } from "../state/clock";
import { Tip, type TriggerProps } from "../ui/Tip";
import { copy } from "./copy";
import { shownKind } from "./FailureLine";

const REVEALING = new Set<Status["kind"]>(["blocked", "needs-you", "working", "error"]);

/** Mounted only while shown, so a hidden reading subscribes to no clock; `live` false reads the clock without demanding it. U6640a: the Rail row shows it in place; `StatusTip` shows it for other surfaces. */
export const Reveal = (props: { status: Status; label?: string; live?: boolean; split?: boolean }) => {
  const now = useDisplayNow(() => props.live ?? true);

  const age = () => {
    const span = elapsed(props.status.since, now());

    return span.unit === "date" ? span.date : span.unit === "now" ? copy.statusAge.now : copy.statusAge[span.unit](span.value);
  };

  // U5231a: an error's reason is the row's FailureLine, so the reveal adds only the age.
  const label = () => props.label ?? props.status.label;

  // U6640b: split, the label is its own cut span and the age keeps its width.
  return <>{props.label === undefined && props.status.kind === "error" ? age() : props.split ? <><span class="row-status-label">{label()}</span><span class="row-status-age">{copy.statusAfterLabel(age())}</span></> : copy.statusReveal(label(), age())}</>;
};

/** Only the handlers and description link: the row keeps its own id, `data-scope` and `data-part`, which the trigger's would overwrite. Merge them with the row's own props by zag's `mergeProps`, which chains handlers. */
const handlers = (trigger: TriggerProps): TriggerProps => Object.fromEntries(Object.entries(trigger).filter(([name]) => name.startsWith("on") || name === "aria-describedby"));

/** U6640a: the kinds whose label and age a Rail row shows in place. */
export const reads = (status: Status | null | undefined, dismissed: boolean): status is Status => !!status && REVEALING.has(shownKind(status, dismissed)) && status.label !== "";

/** U5231a: on hover or focus a row of Kind blocked, needs-you, working or error reads its reason and age; any other row reveals nothing. */
export const StatusTip = (props: { status: Status | null | undefined; dismissed?: boolean; children: (reveal: () => TriggerProps) => JSX.Element }) => {
  const revealed = () => props.status && REVEALING.has(shownKind(props.status, props.dismissed ?? false)) && props.status.label !== "" ? props.status : null;

  return <Tip class="ink-tip status-reveal" disabled={revealed() === null} content={<Show when={revealed()}>{status => <Reveal status={status()} />}</Show>}>{trigger => props.children(() => handlers(trigger()))}</Tip>;
};
