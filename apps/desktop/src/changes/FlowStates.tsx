import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { For, Show } from "solid-js";
import { copy } from "./copy";
import type { CallPathsState } from "./callPaths";

/** U7683f: what each language of the flows says about its trace, and the controls it offers: nothing blocks the list. */
export const FlowStates = (props: { calls: CallPathsState; worktree: boolean }) => <section class="flow-states" aria-label={copy.lenses.flows}>
  <Show when={!props.worktree}><p>{copy.flowsNeedWorktree}</p></Show>
  <Show when={props.calls.failed()}>{cause => <p>{copy.traceFailed(undefined)} <IconButton aria-label={copy.retry} onClick={() => props.calls.retry()}><Icon name="rotate-cw" /></IconButton> <span class="flow-cause">{cause()}</span></p>}</Show>
  <For each={props.calls.lines()}>{line => <p data-state={line.state}>
    {line.state === "tracing" ? copy.tracing(copy.languageName(line.language))
      : line.state === "untraced" ? copy.languageNotTraced(copy.languageName(line.language), line.files)
      : line.state === "noServer" ? copy.noServer(copy.languageName(line.language), line.files)
      : line.state === "failed" ? copy.traceFailed(copy.languageName(line.language))
      : copy.changedSinceTraced}
    <Show when={line.action}>{action => <> <IconButton aria-label={action() === "retry" ? copy.retry : copy.trace} onClick={() => props.calls.trace(line.language)}><Icon name={action() === "retry" ? "rotate-cw" : "workflow"} /></IconButton></>}</Show>
    <Show when={line.state === "failed"}> <span class="flow-cause">{line.cause}</span></Show>
  </p>}</For>
</section>;
