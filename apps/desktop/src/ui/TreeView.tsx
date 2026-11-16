import { For, Show } from "solid-js";
import type { RenderProp } from "@ui-sdk/solid/primitive";
import { Tree, type TreeMode, type TreeProps } from "@ui-sdk/solid/tree";
import "./Tree.css";
import "./Row.css";

type AppTreeProps<Mode extends TreeMode> = Omit<TreeProps<Mode>, "class"> & {
  class?: string;
};

/** The App's tree: the SDK's, drawn with the App's rows. */
export const AppTree = <Mode extends TreeMode = "single">(
  props: AppTreeProps<Mode>,
) => <Tree<Mode> {...props} class={`app-tree ${props.class ?? ""}`} />;

/** A tree item that owns its Tab stop (U31) instead of taking the tree's roving one. */
export const tabStop = (stop: () => boolean) => (item: Parameters<RenderProp>[0]) => <div {...item} tabindex={stop() ? 0 : -1} />;

/** U402: the dashed trunks and the elbow of a row at `depth`. `trail[k]` tells whether the trunk at level `k` runs on below the row; the last entry is the row's own branch, which stops at its elbow when it is false. A `stem` drops from the row's own mark to its children. */
export const Trunks = (props: {
  depth: number;
  trail: readonly boolean[];
  stem: boolean;
}) => (
  <>
    <For each={props.trail.slice(0, -1)}>
      {(runs, at) => (
        <Show when={runs}>
          <span
            class="tree-pass"
            aria-hidden="true"
            style={{ "--level": at() }}
          />
        </Show>
      )}
    </For>
    <Show when={props.depth > 0}>
      <span
        class="tree-branch"
        aria-hidden="true"
        data-last={props.trail.at(-1) ? undefined : "true"}
        style={{ "--level": props.depth - 1 }}
      />
    </Show>
    <Show when={props.stem}>
      <span
        class="tree-stem"
        aria-hidden="true"
        style={{ "--level": props.depth }}
      />
    </Show>
  </>
);
