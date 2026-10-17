import { Dialog as ArkDialog } from "@ark-ui/solid/dialog";
import "./Dialog.css";

export const Dialog = {
  ...ArkDialog,
  Root: (props: ArkDialog.RootProps) => <ArkDialog.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkDialog.ContentProps) => <ArkDialog.Content {...props} class={`app-dialog ${props.class ?? ""}`} />,
};

export const AlertDialog = {
  ...Dialog,
  Root: (props: ArkDialog.RootProps) => <Dialog.Root {...props} role="alertdialog" closeOnInteractOutside />,
};
