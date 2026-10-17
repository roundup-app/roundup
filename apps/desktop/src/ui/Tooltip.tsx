import { Tooltip as ArkTooltip } from "@ark-ui/solid/tooltip";
import "./Tooltip.css";

export const Tooltip = {
  ...ArkTooltip,
  Root: (props: ArkTooltip.RootProps) => <ArkTooltip.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkTooltip.ContentProps) => <ArkTooltip.Content {...props} class={`app-tooltip ${props.class ?? ""}`} />,
};
