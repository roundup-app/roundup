import { Dialog as ArkDialog } from "@ark-ui/solid/dialog";
import { Menu as ArkMenu } from "@ark-ui/solid/menu";
import { Tooltip as ArkTooltip } from "@ark-ui/solid/tooltip";
import { splitProps, type JSX } from "solid-js";
import "./styles.css";

export const Dialog = {
  ...ArkDialog,
  Root: (props: ArkDialog.RootProps) => <ArkDialog.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkDialog.ContentProps) => <ArkDialog.Content {...props} class={`app-dialog ${props.class ?? ""}`} />,
};

export const AlertDialog = {
  ...Dialog,
  Root: (props: ArkDialog.RootProps) => <Dialog.Root {...props} role="alertdialog" closeOnInteractOutside />,
};

export const Menu = {
  ...ArkMenu,
  Root: (props: ArkMenu.RootProps) => <ArkMenu.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkMenu.ContentProps) => <ArkMenu.Content {...props} class={`app-menu ${props.class ?? ""}`} />,
};

export const Tooltip = {
  ...ArkTooltip,
  Root: (props: ArkTooltip.RootProps) => <ArkTooltip.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkTooltip.ContentProps) => <ArkTooltip.Content {...props} class={`app-tooltip ${props.class ?? ""}`} />,
};

export const IconButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { "aria-label": string }) => {
  const [local, rest] = splitProps(props, ["class"]);

  return <button type="button" {...rest} data-button="icon" class={`word ${local.class ?? ""}`} />;
};
