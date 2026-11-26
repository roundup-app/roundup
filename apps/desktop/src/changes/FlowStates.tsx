import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { For, Show } from "solid-js";
import { copy } from "./copy";
import type { CallPathsState, Line } from "./callPaths";
import { failureCause, type ReadbackState } from "./readback";
import { ReadbackAction } from "./ReadbackBlock";

/** U7683f, U7695b: what a language says about its trace: one line, with the icon button it offers (Trace or Retry), if any. */
export const TraceLine = (props: { line: Line; calls: CallPathsState }) => <p data-state={props.line.state}>
  {props.line.state === "tracing" ? copy.tracing(copy.languageName(props.line.language))
    : props.line.state === "untraced" ? copy.languageNotTraced(copy.languageName(props.line.language), props.line.files)
    : props.line.state === "noServer" ? copy.noServer(copy.languageName(props.line.language), props.line.files)
    : props.line.state === "failed" ? copy.traceFailed(copy.languageName(props.line.language))
    : copy.changedSinceTraced}
  <Show when={props.line.action}>{action => <> <IconButton aria-label={action() === "retry" ? copy.retry : copy.trace} onClick={() => props.calls.trace(props.line.language)}><Icon name={action() === "retry" ? "rotate-cw" : "workflow"} /></IconButton></>}</Show>
  <Show when={props.line.state === "failed"}> <span class="flow-cause">{props.line.cause}</span></Show>
</p>;

/** U7683f, U7689d: what each language of the flows says about its trace, and what the readback says while it reads or after it failed, with the controls they offer: nothing blocks the list. */
export const FlowStates = (props: { calls: CallPathsState; readback: ReadbackState; worktree: boolean }) => <section class="flow-states" aria-label={copy.lenses.flows}>
  <Show when={!props.worktree}><p>{copy.flowsNeedWorktree}</p></Show>
  <Show when={props.readback.state().state === "reading"}><p>{copy.readingBack}</p></Show>
  <Show when={failureCause(props.readback.state())}>{cause => <p>{copy.readbackFailed} <ReadbackAction name={copy.retry} icon="rotate-cw" run={() => props.readback.start()} /> <span class="flow-cause">{cause()}</span></p>}</Show>
  <Show when={props.calls.failed()}>{cause => <p>{copy.traceFailed(undefined)} <IconButton aria-label={copy.retry} onClick={() => props.calls.retry()}><Icon name="rotate-cw" /></IconButton> <span class="flow-cause">{cause()}</span></p>}</Show>
  <For each={props.calls.lines()}>{line => <TraceLine line={line} calls={props.calls} />}</For>
</section>;
