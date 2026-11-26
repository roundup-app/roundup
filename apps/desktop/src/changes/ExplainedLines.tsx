import { Match, Show, Switch } from "solid-js";
import { copy } from "./copy";
import { explainCause, explainedText } from "./explain";
import type { Asked, FileExplaining } from "./explain";
import { ReadbackAction } from "./ReadbackBlock";
import { ReadbackDiagram } from "./ReadbackDiagram";

/** U7698b, U7698c: the explanation under the last line of its range: the wait, the cause with Retry, or the credit and the answer in its form, dimmed with Ask again once the file changed. It is no note: it joins no batch and no Message. */
export const ExplainedLines = (props: { asked: Asked; explained: FileExplaining }) => <section class="explained readback-account" data-surface="diff" aria-label={copy.explanation} data-stale={props.explained.stale(props.asked) ? "true" : "false"}>
  <Show when={props.explained.stale(props.asked)}><p>{copy.changedSinceReadback} <ReadbackAction name={copy.askAgain} icon="rotate-cw" run={() => props.explained.ask(props.asked.form, props.asked)} /></p></Show>
  <Switch>
    <Match when={props.asked.answer.state === "asking"}><p role="status">{copy.readingBack}</p></Match>
    <Match when={explainCause(props.asked.answer)}>{cause => <p>{copy.explainFailed} <ReadbackAction name={copy.retry} icon="rotate-cw" run={() => props.explained.ask(props.asked.form, props.asked)} /> <span class="flow-cause">{cause()}</span></p>}</Match>
    <Match when={explainedText(props.asked.answer)}>{text => <div class="readback-text">
      <p class="readback-credit">{copy.readbackCredit}</p>
      <Show when={props.asked.form === "diagram"} fallback={<p class="readback-overview">{text()}</p>}><ReadbackDiagram text={text()} /></Show>
    </div>}</Match>
  </Switch>
</section>;
