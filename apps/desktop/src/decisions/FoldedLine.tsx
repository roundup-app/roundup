import { Show } from "solid-js";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { Icon } from "../ink/Icon";
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
  const { decisions, reducedMotion } = useConnectedProject();

  return (
    <>
      <div class="decision-fold" role="status" tabIndex={-1} data-animated={reducedMotion() ? "false" : "true"} onKeyDown={(key) => { if (key.key === "Escape" && !key.defaultPrevented) { key.stopPropagation(); decisions.dismiss(props.line.agent); } }}>
        <Icon name={props.line.verdict === "denied" ? "x" : "check"} />
        <span>{words(props.line)}</span>
        <code class="decision-fold-target">{props.line.target}</code>
        <Show when={props.line.verdict === "project" && !props.line.removed}>
          <button type="button" data-button="quiet" class="word" aria-disabled={decisions.revoking(props.line.agent) ? true : undefined} onClick={() => { if (!decisions.revoking(props.line.agent)) void decisions.revoke(props.line.agent); }}>{copy.revoke}</button>
        </Show>
      </div>
      <Show when={decisions.revokeFailure(props.line.agent)}>{(message) => <ErrorLine message={message()} />}</Show>
    </>
  );
};
