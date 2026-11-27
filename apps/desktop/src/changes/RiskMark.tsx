import { Show } from "solid-js";
import { Tip } from "../ui/Tip";
import { copy } from "./copy";
import type { RiskMark as Mark } from "./modules";

/** U7697c, U7697d: one small mark for a high or medium risk, named by its level; hovering or focusing it opens the reason, credited to the readback. The reason is never drawn in the row. */
export const RiskMark = (props: { risk: Mark; focusable?: boolean }) => <Tip kind="changing" class="ink-tip" content={<>
  <span class="risk-reason">{props.risk.reason}</span>
  <span class="risk-credit">{copy.readbackCredit}</span>
  <Show when={props.risk.stale}><span class="risk-credit">{copy.changedSinceReadback}</span></Show>
</>}>{trigger => <span {...trigger()} class="risk-mark" role="img" tabindex={props.focusable ? 0 : -1} data-risk={props.risk.level} data-stale={props.risk.stale ? "true" : undefined} aria-label={copy.riskMark[props.risk.level]} />}</Tip>;
