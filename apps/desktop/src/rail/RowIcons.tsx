import { Show, type JSX } from "solid-js";
import { Icon } from "../ink/Icon";

/** U426: what a Workstream row or an Agent row can do from its icons; an absent member is an icon the row does not carry. */
export type RowActions = {
  folder: () => void;
  editor: () => void;
} & (
  | { kind: "workstream"; add: { disabled: boolean; run: (modelPick: boolean) => void }; clear?: () => void }
  | { kind: "agent"; stop?: () => void }
);

const RowIcon = (props: { name: "plus" | "clear" | "stop" | "folder" | "editor"; label: string; title?: string; disabled?: boolean; onClick: (click: MouseEvent) => void; onModel?: () => void }) => (
  <button
    data-button="icon"
    type="button"
    aria-label={props.label}
    title={props.title ?? props.label}
    aria-disabled={props.disabled ? true : undefined}
    onKeyDown={(press) => {
      if (props.onModel && press.altKey && press.key === "Enter") {
        press.preventDefault();
        press.stopPropagation();
        props.onModel();
      }
    }}
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
    {props.children}
    <Show when={props.actions.kind === "workstream" ? props.actions.add : undefined}>
      {(add) => (
        <RowIcon name="plus" label="Add Agent" title="Add Agent ⌘N" disabled={add().disabled} onModel={() => add().run(true)} onClick={(click) => add().run(click.altKey)} />
      )}
    </Show>
    <Show when={props.actions.kind === "workstream" ? props.actions.clear : undefined}>
      {(clear) => <RowIcon name="clear" label="Clear" title="Clear Workstream…" onClick={clear()} />}
    </Show>
    <Show when={props.actions.kind === "agent" ? props.actions.stop : undefined}>{(stop) => <RowIcon name="stop" label="Stop" onClick={stop()} />}</Show>
    <RowIcon name="folder" label="Open folder" onClick={props.actions.folder} />
    <RowIcon name="editor" label="Open in editor" onClick={props.actions.editor} />
  </span>
);
