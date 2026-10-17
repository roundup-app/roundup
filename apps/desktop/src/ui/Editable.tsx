import { Editable as ArkEditable } from "@ark-ui/solid/editable";

export const Editable = {
  ...ArkEditable,
  Root: (props: ArkEditable.RootProps) => <ArkEditable.Root selectOnFocus autoResize {...props} class={`app-editable ${props.class ?? ""}`} />,
};
