import { Popover as ArkPopover } from "@ark-ui/solid/popover";
import { createSignal, onMount } from "solid-js";
import { dialogOwned, floatingControl } from "./Dialog";
import "./Popover.css";

/** A popover that never takes the keyboard on opening and closes on outside interaction or a modal opening (U515's control by a selection). */
export const Popover = {
  ...ArkPopover,
  Root: (props: ArkPopover.RootProps) => {
    const [element, setElement] = createSignal<HTMLElement>();
    const control = floatingControl(props, element);

    return <ArkPopover.Root lazyMount unmountOnExit autoFocus={false} modal={false} closeOnEscape={false} {...props} open={control.open()} onOpenChange={control.change}>
      <ArkPopover.Context>{api => {
        onMount(() => setElement(document.getElementById(api().getAnchorProps().id ?? "") ?? document.getElementById(api().getTriggerProps().id ?? "") ?? undefined));

        return props.children;
      }}</ArkPopover.Context>
    </ArkPopover.Root>;
  },
  Content: (props: ArkPopover.ContentProps) => <ArkPopover.Content {...props} data-dialog-owned={dialogOwned() || undefined} class={`app-popover ${props.class ?? ""}`} />,
};
