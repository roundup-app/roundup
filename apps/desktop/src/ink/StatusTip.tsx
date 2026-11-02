import { Show, type JSX } from "solid-js";
import type { Status } from "@contracts/Status";
import { elapsed } from "../shelf/Age";
import { useDisplayNow } from "../state/clock";
import { Tip, type TriggerProps } from "../ui/Tip";
import { copy } from "./copy";
import { shownKind } from "./FailureLine";

const REVEALING = new Set<Status["kind"]>(["blocked", "needs-you", "working", "error"]);

/** Mounted only while the Tooltip is open, so a hidden reveal subscribes to no clock. */
const Reveal = (props: { status: Status }) => {
  const now = useDisplayNow(() => true);

  const age = () => {
    const span = elapsed(props.status.since, now());

    return span.unit === "date" ? span.date : span.unit === "now" ? copy.statusAge.now : copy.statusAge[span.unit](span.value);
  };

  // U5231a: an error's reason is the row's FailureLine, so the reveal adds only the age.
  return <>{props.status.kind === "error" ? age() : copy.statusReveal(props.status.label, age())}</>;
};

/** Only the handlers and description link: the row keeps its own id, `data-scope` and `data-part`, which the trigger's would overwrite. Merge them with the row's own props by zag's `mergeProps`, which chains handlers. */
const handlers = (trigger: TriggerProps): TriggerProps => Object.fromEntries(Object.entries(trigger).filter(([name]) => name.startsWith("on") || name === "aria-describedby"));

/** U5231a: on hover or focus a row of Kind blocked, needs-you, working or error reads its reason and age; any other row reveals nothing. */
export const StatusTip = (props: { status: Status | null | undefined; dismissed?: boolean; placement?: "right-start" | undefined; children: (reveal: () => TriggerProps) => JSX.Element }) => {
  const revealed = () => props.status && REVEALING.has(shownKind(props.status, props.dismissed ?? false)) && props.status.label !== "" ? props.status : null;

  return <Tip class="ink-tip status-reveal" placement={props.placement} disabled={revealed() === null} content={<Show when={revealed()}>{status => <Reveal status={status()} />}</Show>}>{trigger => props.children(() => handlers(trigger()))}</Tip>;
};
