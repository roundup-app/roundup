import { For, Show } from "solid-js";

/** U402: the dashed trunks and the elbow of a row at `depth`. `trail[k]` tells whether the trunk at level `k` runs on below the row; the last entry is the row's own branch, which stops at its elbow when it is false. A `stem` drops from the row's own mark to its children. */
export const Trunks = (props: { depth: number; trail: readonly boolean[]; stem: boolean }) => (
  <>
    <For each={props.trail.slice(0, -1)}>
      {(runs, at) => <Show when={runs}><span class="rail-pass" aria-hidden="true" style={{ "--level": at() }} /></Show>}
    </For>
    <Show when={props.depth > 0}>
      <span class="rail-branch" aria-hidden="true" data-last={!props.trail.at(-1)} style={{ "--level": props.depth - 1 }} />
    </Show>
    <Show when={props.stem}>
      <span class="rail-stem" aria-hidden="true" style={{ "--level": props.depth }} />
    </Show>
  </>
);
