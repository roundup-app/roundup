import { Show, type ComponentProps } from "solid-js";
import { TreeView } from "../ui/TreeView";
import { Icon } from "./Icon";

/** Shared inert heading, or the control of its caller's Ark tree branch. */
export const SectionHead = (props: {
  icon: ComponentProps<typeof Icon>["name"];
  label: string;
  disclosure?: { open: boolean; setOpen(open: boolean): void };
}) => (
  <Show when={props.disclosure} fallback={<div class="section-head"><Icon name={props.icon} /><span>{props.label}</span></div>}>
    {(disclosure) => <TreeView.BranchControl asChild={control => <button {...control()} type="button" class="section-head" data-button="quiet" aria-expanded={disclosure().open} tabIndex={0} onClick={event => {
      event.stopPropagation();
      disclosure().setOpen(!disclosure().open);
    }} onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") {
        event.stopPropagation();

        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.stopPropagation();
      event.preventDefault();
      disclosure().setOpen(event.key === "ArrowRight");
    }}>
      <Icon name={props.icon} /><span>{props.label}</span>
      <TreeView.BranchIndicator><Icon name="right" /></TreeView.BranchIndicator>
    </button>} />}
  </Show>
);
