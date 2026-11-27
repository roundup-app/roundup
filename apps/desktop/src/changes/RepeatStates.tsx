import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { Show } from "solid-js";
import { copy } from "./copy";
import type { RepeatScan } from "./repeats";
import type { SpotsRead } from "./spots";

/** U7685e: what the repeat check says while it runs, fails, stops short or is not asked; a finished check with none says nothing. */
export const RepeatStates = (props: { scan: RepeatScan; /** The Agent has a Worktree but the comparison is not its Tree. */ notAsked: boolean }) => <Show when={props.notAsked || props.scan.scanning() || props.scan.failed() !== null || props.scan.partial()}>
  <section class="flow-states" aria-label={copy.repeats}>
    <Show when={props.notAsked}><p>{copy.repeatsNeedTree}</p></Show>
    <Show when={props.scan.scanning()}><p>{copy.checkingRepeats}</p></Show>
    <Show when={props.scan.failed()}>{cause => <p>{copy.repeatsFailed} <IconButton aria-label={copy.retry} onClick={() => props.scan.again()}><Icon name="rotate-cw" /></IconButton> <span class="flow-cause">{cause()}</span></p>}</Show>
    <Show when={props.scan.partial()}><p>{copy.repeatsPartial}</p></Show>
  </section>
</Show>;

/** U7704f: what the tool-spot read says when it fails: its cause and Retry; a read that is pending or finds none says nothing. */
export const SpotStates = (props: { spots: SpotsRead }) => <Show when={props.spots.failed()}>{cause => <section class="flow-states" aria-label={copy.spotsFailed}>
  <p>{copy.spotsFailed} <IconButton aria-label={copy.retry} onClick={() => props.spots.again()}><Icon name="rotate-cw" /></IconButton> <span class="flow-cause">{cause()}</span></p>
</section>}</Show>;
