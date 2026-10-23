import { Menu as ArkMenu } from "@ark-ui/solid/menu";
import { createContext, createSignal, useContext } from "solid-js";
import { floatingControl } from "./Dialog";
import "./Menu.css";

const Owner = createContext<(element: HTMLElement) => void>();

export const Menu = {
  ...ArkMenu,
  Root: (props: ArkMenu.RootProps) => {
    const [element, setElement] = createSignal<HTMLElement>();
    const control = floatingControl(props, element);

    return <Owner.Provider value={setElement}><ArkMenu.Root lazyMount unmountOnExit {...props} open={control.open()} onOpenChange={control.change} /></Owner.Provider>;
  },
  Trigger: (props: ArkMenu.TriggerProps) => {
    const setElement = useContext(Owner);

    return <ArkMenu.Trigger {...props} ref={(element: HTMLButtonElement) => {
      setElement?.(element);

      // SAFETY: callers supply callback refs; Solid compiles element bindings into callbacks.
      (props.ref as ((element: HTMLButtonElement) => void) | undefined)?.(element);
    }} />;
  },
  Content: (props: ArkMenu.ContentProps) => <ArkMenu.Content {...props} class={`app-menu ${props.class ?? ""}`} />,
};
