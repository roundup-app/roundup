import { Show } from "solid-js";
import type { Finding } from "@contracts/agent/Finding";
import { copy } from "./copy";
import type { FileFindings } from "./findings";
import { ReadbackAction } from "./ReadbackBlock";

/** U7700c, U7700d, U7700e: a finding under the last line of its range: the credit, its label word and sentence, and the icon buttons to keep it as a note or drop it; dimmed with Drop only once the lines changed. It is no note until kept: it joins no batch and no Message. */
export const FindingLines = (props: { finding: Finding; found: FileFindings }) => <section class="finding" data-surface="diff" aria-label={copy.finding} data-changed={props.found.changed(props.finding) ? "true" : "false"}>
  <p class="readback-credit">{copy.readbackCredit}</p>
  <Show when={props.found.changed(props.finding)}><p>{copy.changedSinceReadback}</p></Show>
  <p><strong>{copy.labels[props.finding.label]}</strong> {props.finding.text}</p>
  <div class="finding-actions">
    <Show when={!props.found.changed(props.finding)}><ReadbackAction name={copy.keepFinding} icon="note-plus" run={() => props.found.keep(props.finding)} /></Show>
    <ReadbackAction name={copy.dropFinding} icon="x" run={() => props.found.drop(props.finding)} />
  </div>
</section>;
