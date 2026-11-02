import { copy } from "./copy";
import { Show, type JSX } from "solid-js";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { ownKeys, type RowActions } from "./rows";

const RowIcon = (props: { name: "rotate-cw" | "plus" | "stop" | "play" | "folder" | "editor" | "more"; label: string; disabled?: boolean; onClick: (click: MouseEvent) => void }) => (
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
        <IconButton
          {...ownKeys}
          class="rail-add"
          aria-label={copy.addAgentLabel}
          aria-disabled={add().disabled || undefined}
          action={add().disabled || add().shortcut === false ? undefined : "agent.new"}
          onClick={(click) => {
            click.stopPropagation();
            add().run();
          }}
        >
          <Icon name="plus" />
        </IconButton>
      )}
    </Show>
    <Show when={props.actions.kind === "workstream" ? props.actions.restart : undefined}>{restart => <>
      <RowIcon name="rotate-cw" label={copy.restart} disabled={restart().pending} onClick={() => restart().run()} />
      <RowIcon name="more" label={copy.rowActions} onClick={restart().menu} />
    </>}</Show>
    {props.children}
    <Show when={props.actions.kind === "agent" ? props.actions.stop : undefined}>{(stop) => <RowIcon name="stop" label={copy.stop} onClick={stop()} />}</Show>
    <Show when={props.actions.kind === "agent" ? props.actions.resume : undefined}>{(resume) => <RowIcon name="play" label={copy.resume} onClick={resume()} />}</Show>
    <Show when={props.actions.kind !== "workstream" || !props.actions.restart}>
      <RowIcon name="folder" label={copy.openFolder} onClick={props.actions.folder} />
      <RowIcon name="editor" label={copy.openInEditor} onClick={props.actions.editor} />
    </Show>
  </span>
);
