import { Menu as ArkMenu } from "@ark-ui/solid/menu";
import "./Menu.css";

export const Menu = {
  ...ArkMenu,
  Root: (props: ArkMenu.RootProps) => <ArkMenu.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkMenu.ContentProps) => <ArkMenu.Content {...props} class={`app-menu ${props.class ?? ""}`} />,
};
