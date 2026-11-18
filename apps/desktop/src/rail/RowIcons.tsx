import { copy } from "./copy";
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { ownKeys, type RowActions } from "./rows";

const RowIcon = (props: { name: "rotate-cw" | "stop" | "play" | "more"; label: string; disabled?: boolean; onClick: (click: MouseEvent) => void }) => (
  <IconButton
    icon={props.name === "stop" ? "stop" : props.name === "more" ? "more" : undefined}
    aria-label={props.label}
    aria-disabled={props.disabled ? "true" : undefined}
    {...ownKeys}
    onClick={(click) => {
      click.stopPropagation();
      props.onClick(click);
    }}
  >
    <Icon name={props.name} />
  </IconButton>
);

/** U7488a: one fixed slot per action; an absent action leaves its slot in place and empty, so every action sits at one x on every row. */
const Slot = (props: { name: "restart" | "run" | "more"; children?: JSX.Element }) => <span class="action-slot" data-slot={props.name}>{props.children}</span>;

/** U426/U7488a/b: restart, play or stop, and more, each in its slot; the shared reveal (rowButton.styles.css) shows them on hover, focus and selection without moving them. */
export const RowIcons = (props: { actions: RowActions; children?: JSX.Element }) => {
  const own = () => props.actions.kind === "workstream" || props.actions.kind === "agent" ? props.actions : undefined;

  return <span class="row-icons" role="group" aria-label={copy.rowActions}>
    <Slot name="restart"><Show when={own()?.restart}>{restart => <RowIcon name="rotate-cw" label={copy.restart} disabled={restart().pending} onClick={() => restart().run()} />}</Show></Slot>
    <Slot name="run">
      {props.children}
      <Show when={props.actions.kind === "agent" ? props.actions.stop : undefined}>{(stop) => <RowIcon name="stop" label={copy.stop} onClick={stop()} />}</Show>
      <Show when={props.actions.kind === "agent" ? props.actions.play : undefined}>{(play) => <RowIcon name="play" label={copy.restart} onClick={play()} />}</Show>
    </Slot>
    <Slot name="more"><Show when={own()?.restart}>{restart => <RowIcon name="more" label={copy.rowActions} onClick={restart().menu} />}</Show></Slot>
  </span>;
};
