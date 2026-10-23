import { Dialog as ArkDialog, useDialogContext } from "@ark-ui/solid/dialog";
import { registerKeys } from "../keys/registry";
import "./Dialog.css";

export const Dialog = {
  ...ArkDialog,
  Root: (props: ArkDialog.RootProps) => <ArkDialog.Root lazyMount unmountOnExit {...props} />,
  Positioner: (props: ArkDialog.PositionerProps) => <ArkDialog.Positioner {...props} class={`app-dialog-positioner ${props.class ?? ""}`} />,
  Content: (props: ArkDialog.ContentProps) => {
    const dialog = useDialogContext();
    let content: HTMLElement | undefined;

    // U3767: the registry's modal layer is what `modalOpen` reads, so what floats under a Dialog can close.
    registerKeys({ kind: "layer", element: () => content, active: () => dialog().open, modal: true }, []);

    return <ArkDialog.Content {...props} ref={(element: HTMLDivElement) => {
      content = element;
      // SAFETY: every caller passes a callback ref; Ark types the prop as the union Solid allows.
      (props.ref as ((element: HTMLDivElement) => void) | undefined)?.(element);
    }} class={`app-dialog ${props.class ?? ""}`} />;
  },
};

export const AlertDialog = {
  ...Dialog,
  Root: (props: ArkDialog.RootProps) => <Dialog.Root {...props} role="alertdialog" closeOnInteractOutside />,
};
