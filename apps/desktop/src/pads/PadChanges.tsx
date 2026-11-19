import { diffLines } from "diff";
import { For, Show } from "solid-js";
import { copy } from "./copy";

/** The diff function, held on an object so a test can count its calls. */
export const lines = { diff: diffLines };

/** U7706a: the lines that changed between the text the user read and the Pad now; unchanged lines are left out. */
export const PadChanges = (props: { before: string | null; after: string; onBack: () => void }) => {
  const parts = () => props.before === null ? [] : lines.diff(props.before, props.after).filter(part => part.added || part.removed);

  return (
    <section class="pad-changes" aria-label={copy.changesSince}>
      <button data-button="quiet" type="button" onClick={() => props.onBack()}>{copy.walkBack}</button>
      <Show when={props.before !== null} fallback={<p class="pad-changes-none">{copy.noEarlierVersion}</p>}>
        <For each={parts()}>{part => <pre class="pad-changes-part" data-change={part.added ? "added" : "removed"}>{part.value}</pre>}</For>
      </Show>
    </section>
  );
};
