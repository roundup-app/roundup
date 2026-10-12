import { Show } from "solid-js";
import { Icon } from "../ink/Icon";

/** U426: what a Workstream row or an Agent row can do from its icons; an absent member is an icon the row does not carry. */
export type RowActions = {
  /** U427: `plus`; `⌥`-click opens the Model pick (U378) instead of adding. */
  add?: { disabled: boolean; run: (modelPick: boolean) => void };
  clear?: () => void;
  stop?: () => void;
  folder: () => void;
  editor: () => void;
};

const RowIcon = (props: { name: "plus" | "clear" | "stop" | "folder" | "editor"; label: string; title?: string; disabled?: boolean; onClick: (click: MouseEvent) => void }) => (
  <button
    data-button="icon"
    type="button"
    aria-label={props.label}
    title={props.title ?? props.label}
    aria-disabled={props.disabled ? true : undefined}
    onClick={(click) => {
      click.stopPropagation();
      props.onClick(click);
    }}
  >
    <Icon name={props.name} />
  </button>
);

/** U426: shown while the row is near (hover, focus within, selected) and otherwise hidden by opacity, so it stays in the Tab order. */
export const RowIcons = (props: { actions: RowActions }) => (
  <span class="row-icons" role="group" aria-label="Row actions">
    <Show when={props.actions.add}>
      {(add) => (
        <RowIcon name="plus" label="add agent" title="add agent ⌘N" disabled={add().disabled} onClick={(click) => add().run(click.altKey)} />
      )}
    </Show>
    <Show when={props.actions.clear}>
      {(clear) => <RowIcon name="clear" label="clear" title="clear workstream…" onClick={clear()} />}
    </Show>
    <Show when={props.actions.stop}>{(stop) => <RowIcon name="stop" label="stop" onClick={stop()} />}</Show>
    <RowIcon name="folder" label="open folder" onClick={props.actions.folder} />
    <RowIcon name="editor" label="open in editor" onClick={props.actions.editor} />
  </span>
);
