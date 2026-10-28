import { Show, type ComponentProps } from "solid-js";
import { Collapsible } from "../ui/Collapsible";
import { Icon } from "./Icon";

/** Shared inert heading, or the trigger of its caller's Ark disclosure. */
export const SectionHead = (props: {
  icon: ComponentProps<typeof Icon>["name"];
  label: string;
  disclosure?: { setOpen(open: boolean): void };
}) => (
  <Show when={props.disclosure} fallback={<div class="section-head"><Icon name={props.icon} /><span>{props.label}</span></div>}>
    {(disclosure) => <Collapsible.Trigger class="section-head" data-button="quiet" onKeyDown={event => {
      event.stopPropagation();

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      disclosure().setOpen(event.key === "ArrowRight");
    }}>
      <Icon name={props.icon} /><span>{props.label}</span>
      <Collapsible.Indicator><Icon name="right" /></Collapsible.Indicator>
    </Collapsible.Trigger>}
  </Show>
);
