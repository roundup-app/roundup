import { Show } from "solid-js";
import type { ComponentProps, JSX } from "@solidjs/web";
import { TreeItem, TreeItemIndicator } from "@ui-sdk/solid/tree";
import { tabStop } from "../ui/TreeView";
import { Icon } from "./Icon";

/** Shared inert heading, or the tree item of its caller's tree whose rows it opens and closes. */
export const SectionHead = (props: {
  icon: ComponentProps<typeof Icon>["name"];
  label: string;
  disclosure?: { value: string; open: boolean; setOpen(open: boolean): void };
  /** A control after the heading, beside it, never inside its button. */
  trailing?: JSX.Element;
}) => (
  <Show when={props.disclosure} fallback={<div class="section-head"><Icon name={props.icon} /><span>{props.label}</span></div>}>
    {(disclosure) => <div class="section-head-row"><TreeItem value={disclosure().value} aria-label={props.label} class="section-head" data-button="quiet" render={tabStop(() => true)} onClick={event => {
      if (!event.defaultPrevented) disclosure().setOpen(!disclosure().open);
    }} onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        disclosure().setOpen(!disclosure().open);

        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      disclosure().setOpen(event.key === "ArrowRight");
    }}>
      <Icon name={props.icon} /><span>{props.label}</span>
      <TreeItemIndicator><Icon name="right" /></TreeItemIndicator>
    </TreeItem>{props.trailing}</div>}
  </Show>
);
