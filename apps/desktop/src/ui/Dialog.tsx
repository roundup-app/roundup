import { Dialog as ArkDialog } from "@ark-ui/solid/dialog";
import { onCleanup } from "solid-js";
import { claimModal } from "./modalOpen";
import "./Dialog.css";

export const Dialog = {
  ...ArkDialog,
  Root: (props: ArkDialog.RootProps) => <ArkDialog.Root lazyMount unmountOnExit {...props} />,
  Positioner: (props: ArkDialog.PositionerProps) => <ArkDialog.Positioner {...props} class={`app-dialog-positioner ${props.class ?? ""}`} />,
  Content: (props: ArkDialog.ContentProps) => {
    onCleanup(claimModal());

    return <ArkDialog.Content {...props} class={`app-dialog ${props.class ?? ""}`} />;
  },
};

export const AlertDialog = {
  ...Dialog,
  Root: (props: ArkDialog.RootProps) => <Dialog.Root {...props} role="alertdialog" closeOnInteractOutside />,
};
