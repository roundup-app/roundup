import { Show, type JSX } from "solid-js";
import { Icon } from "../ink/Icon";

/** U426: what a Workstream row or an Agent row can do from its icons; an absent member is an icon the row does not carry. */
export type RowActions = {
  folder: () => void;
  editor: () => void;
} & (
  | { kind: "workstream"; add: { disabled: boolean; expanded: boolean; run: (modelPick: boolean) => void }; clear?: () => void }
  | { kind: "agent"; stop?: () => void }
);

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
export const RowIcons = (props: { actions: RowActions; children?: JSX.Element }) => (
  <span class="row-icons" role="group" aria-label="Row actions">
    <Show when={props.actions.kind === "workstream" ? props.actions.add : undefined}>
      {(add) => (
        <span class="rail-split-add">
          <button type="button" data-button="quiet" aria-label="Add Agent" title="Add Agent ⌘N" aria-disabled={add().disabled || undefined} onClick={(click) => { click.stopPropagation(); add().run(false); }}><Icon name="plus" /><span class="rail-add-label">Agent</span></button>
          <button type="button" data-button="icon" aria-label="Choose Model and Effort" title="Choose Model and Effort" aria-expanded={add().expanded} aria-disabled={add().disabled || undefined} onClick={(click) => { click.stopPropagation(); add().run(true); }}>▾</button>
        </span>
      )}
    </Show>
    {props.children}
    <Show when={props.actions.kind === "workstream" ? props.actions.clear : undefined}>
      {(clear) => <RowIcon name="clear" label="Clear" title="Clear Workstream…" onClick={clear()} />}
    </Show>
    <Show when={props.actions.kind === "agent" ? props.actions.stop : undefined}>{(stop) => <RowIcon name="stop" label="Stop" onClick={stop()} />}</Show>
    <RowIcon name="folder" label="Open folder" onClick={props.actions.folder} />
    <RowIcon name="editor" label="Open in editor" onClick={props.actions.editor} />
  </span>
);
