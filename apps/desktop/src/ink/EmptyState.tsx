import type { ComponentProps } from "solid-js";
import { Icon } from "./Icon";

/** U38: the quiet line of a list with nothing in it: the tab's icon, a title and one hint. */
export const EmptyState = (props: { icon: ComponentProps<typeof Icon>["name"]; heading: string; hint: string }) => (
  <div class="empty-state">
    <Icon name={props.icon} />
    <p>{props.heading}</p>
    <p class="empty-state-hint">{props.hint}</p>
  </div>
);
