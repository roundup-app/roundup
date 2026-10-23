import { Portal } from "solid-js/web";
import { createSlideLifetime } from "./slideLifetime";
import { createReducedMotion } from "../app/reducedMotion";
import { Dialog as ArkDialog, useDialogContext } from "@ark-ui/solid/dialog";
import { createContext, createEffect, createSignal, Show, on, useContext, type Accessor } from "solid-js";
import { modalOutside, registerKeys } from "../keys/registry";
import "./Dialog.css";

const Ownership = createContext<{ open: Accessor<boolean>; exiting: Accessor<boolean>; animated: Accessor<boolean>; settle: () => void; element: Accessor<HTMLElement | undefined>; setElement: (element: HTMLElement) => void }>();

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
  Root: (props: ArkDialog.RootProps & { instant?: boolean }) => {
    const [element, setElement] = createSignal<HTMLElement>();
    const [local, setLocal] = createSignal(props.defaultOpen ?? false);
    const requested = () => props.open ?? local();
    const lifetime = createSlideLifetime();
    const reduced = window.matchMedia ? createReducedMotion(query => window.matchMedia(query)) : () => true;
    createEffect(on(() => [requested(), reduced()] as const, ([open, reduce]) => {
      lifetime.retarget(open, !props.instant && !reduce && document.documentElement.dataset.keyboardFocus === "false");
    }));
    const animated = lifetime.sliding;

    return <Ownership.Provider value={{ open: requested, element, setElement, exiting: lifetime.exiting, animated, settle: lifetime.settle }}>
      <ArkDialog.Root lazyMount {...props} unmountOnExit={false} open={requested()} onOpenChange={details => { setLocal(details.open); props.onOpenChange?.(details); }}>
        <Show when={requested() || lifetime.exiting()}><Portal><ArkDialog.Backdrop class="app-dialog-backdrop" hidden={!requested() && !lifetime.exiting()} data-open={requested()} data-motion={animated() ? "fade" : undefined} onTransitionEnd={lifetime.settle} /></Portal></Show>
        {props.children}
      </ArkDialog.Root>
    </Ownership.Provider>;
  },
  Positioner: (props: ArkDialog.PositionerProps) => {
    const dialog = useDialogContext();
    const owner = useContext(Ownership);

    return <Show when={(owner?.open() ?? dialog().open) || owner?.exiting()}><Portal><ArkDialog.Positioner {...props} hidden={!dialog().open && !owner?.exiting()} class={`app-dialog-positioner ${props.class ?? ""}`} /></Portal></Show>;
  },
  Content: (props: ArkDialog.ContentProps) => {
    const dialog = useDialogContext();
    const owner = useContext(Ownership);
    let content: HTMLElement | undefined;

    // U3767: the registry's modal layer is what `modalOpen` reads, so what floats under a Dialog can close.
    registerKeys({ kind: "layer", element: () => content, active: () => owner?.open() ?? dialog().open, modal: true }, []);

    return <Show when={(owner?.open() ?? dialog().open) || owner?.exiting()}><ArkDialog.Content {...props} hidden={!dialog().open && !owner?.exiting()} inert={!(owner?.open() ?? dialog().open)} data-open={owner?.open() ?? dialog().open} data-motion={owner?.animated() ? "fade" : undefined}
      onTransitionEnd={event => { if (event.target === content && event.propertyName === "opacity") owner?.settle(); }} ref={(element: HTMLDivElement) => {
      content = element;
      owner?.setElement(element);
      // SAFETY: every caller passes a callback ref; Ark types the prop as the union Solid allows.
      (props.ref as ((element: HTMLDivElement) => void) | undefined)?.(element);
    }} class={`app-dialog ${props.class ?? ""}`} /></Show>;
  },
};

export const AlertDialog = {
  ...Dialog,
  Root: (props: ArkDialog.RootProps) => <Dialog.Root {...props} role="alertdialog" closeOnInteractOutside />,
};
