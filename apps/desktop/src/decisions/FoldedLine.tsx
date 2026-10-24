import { Show } from "solid-js";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import type { Folded } from "./decisions";
import "./styles.css";

const words = (line: Folded): string => {
  switch (line.verdict) {
    case "once": return copy.allowedOnce;
    case "session": return copy.allowedForSession;
    case "project": return line.removed ? copy.allowedForProjectGone : copy.allowedForProject;
    case "denied": return copy.denied;
  }
};

/** U3795: the one line an answered permission Card folds to, with Revoke while a `project` Grant lasts. */
export const FoldedLine = (props: { line: Folded }) => {
  const { decisions } = useConnectedProject();

  return (
    <>
      <ReservedLine class="decision-fold" message={decisions.revokeFailure(props.line.agent)} status={`${words(props.line)} ${props.line.target}`} tabIndex={-1} onKeyDown={(key) => { if (key.key === "Escape" && !key.defaultPrevented) { key.stopPropagation(); decisions.dismiss(props.line.agent); } }}>
        <Show when={decisions.revokeFailure(props.line.agent)}><button type="button" data-button="quiet" onClick={() => decisions.dismissRevokeFailure(props.line.agent)}>Dismiss</button></Show>
        <Show when={props.line.verdict === "project" && !props.line.removed}>
          <button type="button" data-button="quiet" class="word" aria-disabled={decisions.revoking(props.line.agent) ? true : undefined} onClick={() => { if (!decisions.revoking(props.line.agent)) void decisions.revoke(props.line.agent); }}>{copy.revoke}</button>
        </Show>
      </ReservedLine>
    </>
  );
};
