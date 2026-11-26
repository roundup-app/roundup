import { For, Match, Show, Switch } from "solid-js";
import { copy } from "./copy";
import type { FindingsState } from "./findings";
import { ReadbackAction } from "./ReadbackBlock";

/** U7700b, U7700e: the pass in the Overview: the quiet line and the icon button before one, then its states and the findings still to keep or drop, each a link to its file or, once the file left the listing, the same words with Drop only. Not on a comparison with no Worktree. */
export const FindingsBlock = (props: { findings: FindingsState; listed: (path: string) => boolean; go: (path: string) => void }) => <Show when={props.findings.offered()}>
  <section class="readback findings" aria-label={copy.findings}>
    <Switch>
      <Match when={props.findings.state() === "notRun"}><p>{copy.findingsQuiet}</p><ReadbackAction name={copy.findDefects} icon="bug" run={props.findings.ask} /></Match>
      <Match when={props.findings.state() === "running"}><p role="status">{copy.lookingForDefects}</p></Match>
      <Match when={props.findings.cause()}>{cause => <p>{copy.findingsFailed} <ReadbackAction name={copy.retry} icon="rotate-cw" run={props.findings.ask} /> <span class="flow-cause">{cause()}</span></p>}</Match>
      <Match when={true}>
        <Show when={props.findings.stale()}><p>{copy.changedSinceReadback} <ReadbackAction name={copy.findAgain} icon="rotate-cw" run={props.findings.ask} /></p></Show>
        <Show when={props.findings.list().length > 0} fallback={<p>{copy.noFindings}</p>}>
          <p>{copy.findingsCount(props.findings.list().length)}</p>
          <ul class="readback-gaps" aria-label={copy.findings}>
            <For each={props.findings.list()}>{finding => <li>
              <Show when={props.listed(finding.path)} fallback={<><span class="readback-gap"><strong>{copy.labels[finding.label]}</strong> {copy.repeatPlace(finding.path, finding.start, finding.end)} {finding.text}</span><ReadbackAction name={copy.dropFinding} icon="x" run={() => props.findings.drop(finding)} /></>}>
                <button type="button" data-button="quiet" class="readback-gap" aria-label={copy.openGap(copy.repeatPlace(finding.path, finding.start, finding.end))} onClick={() => props.go(finding.path)}><strong>{copy.labels[finding.label]}</strong> {copy.repeatPlace(finding.path, finding.start, finding.end)} {finding.text}</button>
              </Show>
            </li>}</For>
          </ul>
        </Show>
      </Match>
    </Switch>
  </section>
</Show>;
