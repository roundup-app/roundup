import "./Field.css";
import { captureFocus } from "../keys/focus";
import { sourceOf } from "@ui-sdk/core";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  untrack,
  useContext,
  type Accessor,
} from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  createReducedMotion,
  ReducedMotionContext,
} from "../app/reducedMotion";
import {
  AlertDialog as UiAlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/solid/alert-dialog";
import {
  Dialog as UiDialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  type DialogFinalFocus,
  type DialogInitialFocus,
} from "@ui-sdk/solid/dialog";
import { modalOutside, registerKeys } from "../keys/registry";
import "./Dialog.css";

type Owner = {
  open: Accessor<boolean>;
  animated: Accessor<boolean>;
  element: Accessor<HTMLElement | undefined>;
  setElement: (element: HTMLElement) => void;
  initialFocus: Accessor<DialogInitialFocus>;
  finalFocus: () => HTMLElement | null | undefined;
};

const Ownership = createContext<Owner | null>(null);

/** Modal dismissal uses the Solid owner, so portalled choice lists still belong to their Dialog.
 * Suppression stays latched until an explicit opening; removing a modal never reopens a background control. */
export const createFloatingControl = (
  props: {
    open?: boolean | undefined;
    defaultOpen?: boolean | undefined;
    onOpenChange?: ((details: { open: boolean }) => void) | undefined;
  },
  element: Accessor<HTMLElement | undefined> = () => undefined,
) => {
  const owner = useContext(Ownership);
  const [local, setLocal] = createSignal(() => props.defaultOpen ?? false);
  const [dismissed, setDismissed] = createSignal(false);
  const requested = () => props.open ?? local();

  const blocked = () =>
    owner
      ? owner.element() !== undefined && modalOutside(owner.element())
      : modalOutside(element());

  const change = (details: { open: boolean }) => {
    if (details.open && blocked()) return;
    setDismissed(false);
    setLocal(details.open);
    props.onOpenChange?.(details);
  };

  createEffect(
    () => [requested(), blocked(), dismissed()] as const,
    ([wanted, outside, kept]) => {
      if (!wanted) setDismissed(false);
      else if (outside && !kept) {
        setDismissed(true);
        setLocal(false);
        props.onOpenChange?.({ open: false });
      }
    },
  );

  // A memo: Popover, Tooltip and Menu apply on each recompute, so an unchanged opening must not re-run them.
  const open = createMemo(() => requested() && !blocked() && !dismissed());

  return { open, blocked, change };
};

type RootProps = {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  instant?: boolean | undefined;
  modal?: boolean | undefined;
  closeOnInteractOutside?: boolean | undefined;
  initialFocusEl?: (() => HTMLElement | null | undefined) | undefined;
  finalFocusEl?: (() => HTMLElement | null | undefined) | undefined;
  onOpenChange?: ((details: { open: boolean }) => void) | undefined;
  children?: JSX.Element;
};

type ContentProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "style"> & {
  style?: JSX.CSSProperties | string;
};

const createOwnership = (props: RootProps) => {
  const [element, setElement] = createSignal<HTMLElement>();
  const [local, setLocal] = createSignal(() => props.defaultOpen ?? false);
  const requested = () => props.open ?? local();

  const reduced =
    useContext(ReducedMotionContext) ??
    (window.matchMedia
      ? createReducedMotion((query) => window.matchMedia(query))
      : () => true);

  // U3512d: a key-open or key-close is instant, so the last input modality decides whether a modal fades.
  const animated = createMemo(() => {
    requested();

    return !props.instant && !reduced() && sourceOf() !== "keyboard";
  });

  let restore = captureFocus();

  createEffect(requested, (open, was) => {
    if (!open && was) restore = captureFocus();
  });

  const owner: Owner = {
    open: requested,
    animated,
    element,
    setElement,
    initialFocus: () => props.initialFocusEl ?? "auto",
    finalFocus: () => restore.target(() => untrack(() => props.finalFocusEl?.())),
  };

  const change = (open: boolean) => {
    setLocal(open);
    props.onOpenChange?.({ open });
  };

  return { owner, change };
};

const content =
  (
    Content: (
      props: ContentProps & {
        initialFocus?: DialogInitialFocus;
        finalFocus?: DialogFinalFocus;
      },
    ) => JSX.Element,
  ) =>
  (props: ContentProps) => {
    const owner = useContext(Ownership);

    if (!owner) throw new Error("A Dialog's content renders inside its Root.");

    // U3767: the registry's modal layer is what `modalOpen` reads, so what floats under a Dialog can close.
    registerKeys(
      {
        kind: "layer",
        element: owner.element,
        active: owner.open,
        modal: true,
      },
      [],
    );

    return (
      <Content
        {...props}
        class={["app-dialog", props.class]}
        inert={!owner.open()}
        data-motion={owner.animated() ? "fade" : undefined}
        initialFocus={owner.initialFocus()}
        finalFocus={owner.finalFocus}
        ref={(element: HTMLElement) => {
          owner.setElement(element);
          // SAFETY: every caller passes a callback ref; the prop is typed as the union Solid allows.
          (props.ref as ((element: HTMLElement) => void) | undefined)?.(
            element,
          );
        }}
      />
    );
  };

export const Dialog = {
  Root: (props: RootProps) => {
    const { owner, change } = createOwnership(props);

    return (
      <Ownership value={owner}>
        <UiDialog
          open={owner.open()}
          modal={props.modal ?? true}
          closeOnOutsidePress={props.closeOnInteractOutside ?? true}
          onOpenChange={change}
        >
          <DialogBackdrop
            class="app-dialog-backdrop"
            data-motion={owner.animated() ? "fade" : undefined}
          />
          {props.children}
        </UiDialog>
      </Ownership>
    );
  },
  Content: content(DialogContent),
  Title: DialogTitle,
  Description: DialogDescription,
  CloseTrigger: DialogClose,
  Trigger: DialogTrigger,
};

export const AlertDialog = {
  Root: (props: RootProps) => {
    const { owner, change } = createOwnership(props);

    return (
      <Ownership value={owner}>
        <UiAlertDialog open={owner.open()} onOpenChange={change}>
          <AlertDialogBackdrop
            class="app-dialog-backdrop"
            data-motion={owner.animated() ? "fade" : undefined}
          />
          {props.children}
        </UiAlertDialog>
      </Ownership>
    );
  },
  Content: content(AlertDialogContent),
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
  CloseTrigger: AlertDialogClose,
  Trigger: AlertDialogTrigger,
};
