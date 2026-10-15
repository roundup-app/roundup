import { Dialog as ArkDialog } from "@ark-ui/solid/dialog";
import { Menu as ArkMenu } from "@ark-ui/solid/menu";
import { Tooltip as ArkTooltip } from "@ark-ui/solid/tooltip";
import { mergeProps, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
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
  const [local, rest] = splitProps(props, ["class", "onClick"]);

  const click: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (props["aria-disabled"] === true || props["aria-disabled"] === "true") {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const handler = local.onClick;

    if (!handler) return;

    if (0 in handler) handler[0](handler[1], event);
    else handler(event);
  };

  // Escape belongs to the surrounding App surface; blur and pointer leave dismiss the name.
  return <Tooltip.Root closeOnEscape={false}>
    <Tooltip.Trigger asChild={(trigger) => <button {...trigger(mergeProps({ type: "button" as const }, rest, { onClick: click }))} data-button="icon" class={`word ${local.class ?? ""}`} />} />
    <Portal><Tooltip.Positioner><Tooltip.Content>{props["aria-label"]}</Tooltip.Content></Tooltip.Positioner></Portal>
  </Tooltip.Root>;
};
