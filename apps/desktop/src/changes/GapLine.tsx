import type { Gap } from "@contracts/agent/Gap";
import { copy } from "./copy";

/** U7688e: the mark under the line a gap names: what the Agent said and what the diff holds there. */
export const GapLine = (props: { agent: string; gap: Gap }) => <div class="gap-mark" data-surface="diff" role="note">
  <p>{copy.gapSaid(props.agent, props.gap.said)}</p>
  <p>{copy.gapDiff(props.gap.quote)}</p>
</div>;
