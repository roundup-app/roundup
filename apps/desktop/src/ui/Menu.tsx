import { Menu as ArkMenu } from "@ark-ui/solid/menu";
import { createSignal, onMount } from "solid-js";
import { floatingControl } from "./Dialog";
import "./Menu.css";

export const Menu = {
  ...ArkMenu,
  Root: (props: ArkMenu.RootProps) => {
    const [element, setElement] = createSignal<HTMLElement>();
    const control = floatingControl(props, element);

    return <ArkMenu.Root lazyMount unmountOnExit {...props} open={control.open()} onOpenChange={control.change}>
      <ArkMenu.Context>{api => {
        onMount(() => setElement(document.getElementById(api().getTriggerProps().id ?? "") ?? undefined));

        return props.children;
      }}</ArkMenu.Context>
    </ArkMenu.Root>;
  },
  Content: (props: ArkMenu.ContentProps) => <ArkMenu.Content {...props} class={`app-menu ${props.class ?? ""}`} />,
};
