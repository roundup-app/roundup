import type { ComponentProps } from "solid-js";
import { Icon } from "./Icon";

/** U447: an inert section label. */
export const SectionHead = (props: { icon: ComponentProps<typeof Icon>["name"]; label: string }) => (
  <div class="section-head">
    <Icon name={props.icon} />
    <span>{props.label}</span>
  </div>
);
