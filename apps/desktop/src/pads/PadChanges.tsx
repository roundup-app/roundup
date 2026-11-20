import { diffLines } from "diff";
import type { JSX } from "@solidjs/web";
import type { Pad } from "@contracts/pad/Pad";
import { createEffect, createSignal, For, Show, type Accessor } from "solid-js";
import { copy } from "./copy";
import { usePadRead } from "./padRead";
import type { PadList } from "./padList";

/** The diff function, kept on an object so a test can count its calls. */
export const lines = { diff: diffLines };

const rows = (value: string) => value.replace(/\n$/, "").split("\n");

/** U7706a: the lines that changed between the text the user read and the Pad now; unchanged lines are left out. */
const PadChanges = (props: { before: string | null; after: string }) => {
  const parts = () => props.before === null ? [] : lines.diff(props.before, props.after).filter(part => part.added || part.removed);

  return (
    <section class="pad-changes" aria-label={copy.changesSince}>
      <div class="pad-changes-scroll">
        <Show when={props.before !== null} fallback={<p class="pad-changes-none">{copy.noEarlierVersion}</p>}>
          <For each={parts()}>{part => (
            <div class="pad-changes-hunk">
              <For each={rows(part.value)}>{row => (
                <pre class="pad-changes-part" data-change={part.added ? "added" : "removed"}>{part.added ? <ins>{row}</ins> : <del>{row}</del>}</pre>
              )}</For>
            </div>
          )}</For>
        </Show>
      </div>
    </section>
  );
};

/** U7706a: the action shows exactly while U7499b marks the Pad changed. */
export const usePadChanges = (list: PadList, initial: Pick<Pad, "incarnation" | "revision">, pads: Accessor<readonly Pad[]>) => {
  const padRead = usePadRead(list);
  const [diffing, setDiffing] = createSignal(false);
  
  // A list that still holds the Revision the Drawer opened on is behind the user's own save, not changed by another Actor.
  const changed = () => {
    const pad = pads().find(one => one.incarnation === initial.incarnation);

    return pad !== undefined && pad.revision > initial.revision && padRead.mark(pad) === "changed" ? pad : null;
  };

  createEffect(changed, pad => { if (!pad) setDiffing(false); });

  return { changed, diffing, setDiffing, kept: padRead.kept };
};

type Changes = ReturnType<typeof usePadChanges>;

export const PadChangesAction = (props: { changes: Changes }) => (
  <Show when={props.changes.changed()}>
    <button data-button="quiet" type="button" class="word" aria-pressed={props.changes.diffing() ? "true" : "false"} onClick={() => props.changes.setDiffing(!props.changes.diffing())}>{copy.changesSince}</button>
  </Show>
);

/** The changes in place of the editor while asked for; the editor stays mounted so its draft survives. */
export const PadChangesView = (props: { changes: Changes; children: JSX.Element }) => (
  <>
    <Show when={props.changes.diffing() && props.changes.changed()}>
      {pad => <PadChanges before={props.changes.kept(pad())} after={pad().text} />}
    </Show>
    <div style={{ display: props.changes.diffing() ? "none" : "contents" }}>{props.children}</div>
  </>
);
