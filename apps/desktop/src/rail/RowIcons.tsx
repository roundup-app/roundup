import { CHORDS } from "../keys/chords";
import { copy } from "../copy";
import { Show, type JSX } from "solid-js";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { Tip } from "./Tip";
import { ownKeys } from "./rows";

/** U426: what a Workstream row or an Agent row can do from its icons; an absent member is an icon the row does not carry. */
export type RowActions = {
  folder: () => void;
  editor: () => void;
} & (
  | { kind: "workstream"; add: { disabled: boolean; run: () => void }; clear?: () => void }
  | { kind: "agent"; stop?: () => void; resume?: () => void }
);

const RowIcon = (props: { name: "plus" | "clear" | "stop" | "play" | "folder" | "editor"; label: string; disabled?: boolean; onClick: (click: MouseEvent) => void }) => (
  <IconButton
    aria-label={props.label}
    aria-disabled={props.disabled ? true : undefined}
    {...ownKeys}
    onClick={(click) => {
      click.stopPropagation();
      props.onClick(click);
    }}
  >
    <Icon name={props.name} />
  </IconButton>
);

/** U426: shown while the row is near (hover, focus within, selected) and otherwise hidden by opacity, so it stays in the Tab order. */
export const RowIcons = (props: { actions: RowActions; children?: JSX.Element }) => (
  <span class="row-icons" role="group" aria-label={copy.rowActions}>
    <Show when={props.actions.kind === "workstream" ? props.actions.add : undefined}>
      {(add) => (
        <Tip text={copy.newAgent} chord={CHORDS[0]}>
            {(trigger) => <button {...trigger({ ...ownKeys, "aria-label": copy.addAgentLabel, "aria-disabled": add().disabled || undefined, onClick: (click: MouseEvent) => { click.stopPropagation(); add().run(); } })} type="button" class="rail-add" data-button="quiet"><Icon name="plus" /><span class="rail-add-label">{copy.agent}</span></button>}
          </Tip>
      )}
    </Show>
    {props.children}
    <Show when={props.actions.kind === "workstream" ? props.actions.clear : undefined}>
      {(clear) => <RowIcon name="clear" label={copy.clearWorkstream} onClick={clear()} />}
    </Show>
    <Show when={props.actions.kind === "agent" ? props.actions.stop : undefined}>{(stop) => <RowIcon name="stop" label={copy.stop} onClick={stop()} />}</Show>
    <Show when={props.actions.kind === "agent" ? props.actions.resume : undefined}>{(resume) => <RowIcon name="play" label={copy.resume} onClick={resume()} />}</Show>
    <RowIcon name="folder" label={copy.openFolder} onClick={props.actions.folder} />
    <RowIcon name="editor" label={copy.openInEditor} onClick={props.actions.editor} />
  </span>
);
