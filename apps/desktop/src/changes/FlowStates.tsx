import { For, Show } from "solid-js";
import { copy } from "./copy";
import type { CallPathsState } from "./callPaths";
import { failureCause, type ReadbackState } from "./readback";
import { ReadbackAction } from "./ReadbackBlock";

/** U7683f, U7689d: what each language of the flows says about its trace, and what the readback says while it reads or after it failed, with the controls they offer: nothing blocks the list. */
export const FlowStates = (props: { calls: CallPathsState; readback: ReadbackState; worktree: boolean }) => <section class="flow-states" aria-label={copy.lenses.flows}>
  <Show when={!props.worktree}><p>{copy.flowsNeedWorktree}</p></Show>
  <Show when={props.readback.state().state === "reading"}><p>{copy.readingBack}</p></Show>
  <Show when={failureCause(props.readback.state())}>{cause => <p>{copy.readbackFailed} <ReadbackAction name={copy.retry} icon="rotate-cw" run={() => props.readback.start()} /> <span class="flow-cause">{cause()}</span></p>}</Show>
  <Show when={props.calls.failed()}>{cause => <p>{copy.traceFailed(undefined)} <button type="button" data-button="quiet" onClick={() => props.calls.retry()}>{copy.retry}</button> <span class="flow-cause">{cause()}</span></p>}</Show>
  <For each={props.calls.lines()}>{line => <p data-state={line.state}>
    {line.state === "tracing" ? copy.tracing(copy.languageName(line.language))
      : line.state === "untraced" ? copy.languageNotTraced(copy.languageName(line.language), line.files)
      : line.state === "noServer" ? copy.noServer(copy.languageName(line.language), line.files)
      : line.state === "failed" ? copy.traceFailed(copy.languageName(line.language))
      : copy.changedSinceTraced}
    <Show when={line.action}>{action => <> <button type="button" data-button="quiet" onClick={() => props.calls.trace(line.language)}>{action() === "retry" ? copy.retry : copy.trace}</button></>}</Show>
    <Show when={line.state === "failed"}> <span class="flow-cause">{line.cause}</span></Show>
  </p>}</For>
</section>;
