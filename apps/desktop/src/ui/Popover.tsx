import { Popover as ArkPopover } from "@ark-ui/solid/popover";
import "./Popover.css";

/** A popover that never takes the keyboard on opening and closes only when its owner says so (U515's control by a selection). */
export const Popover = {
  ...ArkPopover,
  Root: (props: ArkPopover.RootProps) => <ArkPopover.Root lazyMount unmountOnExit autoFocus={false} modal={false} closeOnInteractOutside={false} closeOnEscape={false} {...props} />,
  Content: (props: ArkPopover.ContentProps) => <ArkPopover.Content {...props} class={`app-popover ${props.class ?? ""}`} />,
};
