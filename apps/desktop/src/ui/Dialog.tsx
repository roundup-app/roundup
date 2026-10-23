import { Dialog as ArkDialog, useDialogContext } from "@ark-ui/solid/dialog";
import { createContext, createEffect, createSignal, useContext, type Accessor } from "solid-js";
import { modalOutside, registerKeys } from "../keys/registry";
import "./Dialog.css";

const Ownership = createContext<{ element: Accessor<HTMLElement | undefined>; setElement: (element: HTMLElement) => void }>();

/** Whether this Solid owner belongs to a Dialog, including through Portals. */
export const dialogOwned = (): boolean => useContext(Ownership) !== undefined;

/** Modal dismissal uses the Solid owner, so portalled choice lists still belong to their Dialog.
 * Suppression stays latched until an explicit opening; removing a modal never reopens a background control. */
export const floatingControl = (props: { open?: boolean | undefined; defaultOpen?: boolean | undefined; onOpenChange?: ((details: { open: boolean }) => void) | undefined }, element: Accessor<HTMLElement | undefined> = () => undefined) => {
  const owner = useContext(Ownership);
  const [local, setLocal] = createSignal(props.defaultOpen ?? false);
  const [dismissed, setDismissed] = createSignal(false);
  const requested = () => props.open ?? local();
  const blocked = () => owner ? owner.element() !== undefined && modalOutside(owner.element()) : modalOutside(element());

  const change = (details: { open: boolean }) => {
    if (details.open && blocked()) return;
    setDismissed(false);
    setLocal(details.open);
    props.onOpenChange?.(details);
  };

  createEffect(() => {
    if (!requested()) setDismissed(false);
    else if (blocked() && !dismissed()) {
      setDismissed(true);
      setLocal(false);
      props.onOpenChange?.({ open: false });
    }
  });

  return { open: () => requested() && !blocked() && !dismissed(), blocked, change };
};

export const Dialog = {
  ...ArkDialog,
  Root: (props: ArkDialog.RootProps) => {
    const [element, setElement] = createSignal<HTMLElement>();

    return <Ownership.Provider value={{ element, setElement }}><ArkDialog.Root lazyMount unmountOnExit {...props} /></Ownership.Provider>;
  },
  Positioner: (props: ArkDialog.PositionerProps) => <ArkDialog.Positioner {...props} class={`app-dialog-positioner ${props.class ?? ""}`} />,
  Content: (props: ArkDialog.ContentProps) => {
    const dialog = useDialogContext();
    const owner = useContext(Ownership);
    let content: HTMLElement | undefined;

    // U3767: the registry's modal layer is what `modalOpen` reads, so what floats under a Dialog can close.
    registerKeys({ kind: "layer", element: () => content, active: () => dialog().open, modal: true }, []);

    return <ArkDialog.Content {...props} ref={(element: HTMLDivElement) => {
      content = element;
      owner?.setElement(element);
      // SAFETY: every caller passes a callback ref; Ark types the prop as the union Solid allows.
      (props.ref as ((element: HTMLDivElement) => void) | undefined)?.(element);
    }} class={`app-dialog ${props.class ?? ""}`} />;
  },
};

export const AlertDialog = {
  ...Dialog,
  Root: (props: ArkDialog.RootProps) => <Dialog.Root {...props} role="alertdialog" closeOnInteractOutside />,
};
