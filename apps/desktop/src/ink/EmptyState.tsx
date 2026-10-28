import { createUniqueId, Show, type ComponentProps, type JSX } from "solid-js";
import { Icon } from "./Icon";

/** U4464: one named empty view; the owning surface supplies its next action. */
export const EmptyState = (props: { art: ComponentProps<typeof Icon>["name"]; title: string; line: string; action?: JSX.Element; chip?: string | undefined; state?: string | undefined }) => {
  const title = createUniqueId();

  return <div class="empty-state" role="group" aria-labelledby={title}>
    <div class="empty-state-art" aria-hidden="true"><Icon name={props.art} /></div>
    <h3 id={title} class="empty-state-title" data-state={props.state}>{props.title}</h3>
    <p class="empty-state-line">{props.line}</p>
    <Show when={props.action}>{props.action}</Show>
    <Show when={props.chip}>{chip => <kbd class="empty-state-chip">{chip()}</kbd>}</Show>
  </div>;
};
