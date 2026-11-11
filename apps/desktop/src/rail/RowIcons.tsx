import { copy } from "./copy";
import { Show, type JSX } from "solid-js";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { ownKeys, type RowActions } from "./rows";

const RowIcon = (props: { name: "rotate-cw" | "stop" | "play" | "more"; label: string; disabled?: boolean; onClick: (click: MouseEvent) => void }) => (
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

/** U426/U4896: hover and focus reveal actions by opacity without changing their Tab order. */
export const RowIcons = (props: { actions: RowActions; children?: JSX.Element }) => (
  <Show when={props.actions.kind === "workstream" || (props.actions.kind === "agent" && (props.actions.restart || props.actions.stop || props.actions.resume))}>
    <span class="row-icons" role="group" aria-label={copy.rowActions}>
      <Show when={props.actions.kind === "workstream" || props.actions.kind === "agent" ? props.actions.restart : undefined}>{restart => <>
        <RowIcon name="rotate-cw" label={copy.restart} disabled={restart().pending} onClick={() => restart().run()} />
        <RowIcon name="more" label={copy.rowActions} onClick={restart().menu} />
      </>}</Show>
      {props.children}
      <Show when={props.actions.kind === "agent" ? props.actions.stop : undefined}>{(stop) => <RowIcon name="stop" label={copy.stop} onClick={stop()} />}</Show>
      <Show when={props.actions.kind === "agent" ? props.actions.resume : undefined}>{(resume) => <RowIcon name="play" label={copy.resume} onClick={resume()} />}</Show>
    </span>
  </Show>
);
