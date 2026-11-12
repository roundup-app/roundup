import type { Status } from "@contracts/Status";
import { elapsed, useDisplayNow } from "../state/clock";
import { copy } from "./copy";
import { shownKind } from "./FailureLine";

const REVEALING = new Set<Status["kind"]>(["blocked", "needs-you", "working", "error"]);

/** Mounted only while shown, so a hidden reading subscribes to no clock; `live` false reads the clock without demanding it. U6640a: the Rail row shows it in place. */
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

/** U6640a: the kinds whose label and age a Rail row shows in place. */
export const reads = (status: Status | null | undefined, dismissed: boolean): status is Status => !!status && REVEALING.has(shownKind(status, dismissed)) && status.label !== "";
