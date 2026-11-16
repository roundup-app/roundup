import { captureFocus } from "../keys/focus";
import type { ComponentProps } from "@solidjs/web";
import { Popover as UiPopover, PopoverContent, PopoverTrigger, type PopoverContentProps, type PopoverProps } from "@ui-sdk/solid/popover";
import { createContext, createEffect, createSignal, omit, useContext } from "solid-js";
import { createFloatingControl } from "./Dialog";
import "./Trigger.css";
import "./Popover.css";

type Permission = ReturnType<typeof captureFocus>;

const Owner = createContext<{ setTrigger: (element: HTMLElement) => void; initialFocus: () => Permission; initialTarget: () => HTMLElement; finalFocus: () => NonNullable<PopoverContentProps["finalFocus"]>; close: () => void } | null>(null);

type RootProps = Omit<PopoverProps, "open" | "defaultOpen" | "onOpenChange"> & {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((details: { open: boolean }) => void) | undefined;
  initialFocus?: Permission | undefined;
  initialFocusEl?: (() => HTMLElement | null | undefined) | undefined;
  finalFocusEl?: (() => HTMLElement | null | undefined) | undefined;
  /** Whether a press or focus outside closes the popover. */
  closeOnInteractOutside?: boolean | undefined;
};

const dismissals = new Set(["outside-press", "focus-out"]);

const inside = () => {
  const owner = useContext(Owner);

  if (!owner) throw new Error("Popover parts belong inside Popover.Root");

  return owner;
};

/** A popover that never takes the keyboard on opening and closes on Escape, outside interaction or a modal opening. */
export const Popover = {
  initialFocus: () => useContext(Owner)?.initialFocus(),
  dismiss: () => useContext(Owner)?.close,
  Root: (props: RootProps) => {
    const [trigger, setTrigger] = createSignal<HTMLElement>();
    const control = createFloatingControl(props, trigger);
    let initial: Permission | undefined;
    let returnFocus = true;
    const initialFocus = () => initial ??= props.initialFocus ?? captureFocus(true);
    const active = () => document.activeElement instanceof HTMLElement ? document.activeElement : document.body;

    createEffect(control.open, open => {
      if (open) returnFocus = true;
      else initial = undefined;
    });

    const owner = {
      setTrigger,
      initialFocus,
      initialTarget: () => props.initialFocusEl ? initialFocus().target(() => props.initialFocusEl?.()) : active(),
      finalFocus: () => returnFocus ? props.finalFocusEl ?? "trigger" : "none",
      close: () => { if (control.open()) { returnFocus = false; control.change({ open: false }); } },
    };

    const rest = omit(props, "open", "defaultOpen", "onOpenChange", "initialFocus", "initialFocusEl", "finalFocusEl", "closeOnInteractOutside");

    return <Owner value={owner}>
      <UiPopover {...rest} open={control.open()}
        onOpenChange={(open, details) => {
          if (!open && props.closeOnInteractOutside === false && dismissals.has(details.reason)) details.cancel();
          else control.change({ open });
        }} />
    </Owner>;
  },
  Trigger: (props: ComponentProps<typeof PopoverTrigger>) => {
    const owner = inside();

    return <PopoverTrigger {...props} ref={[props.ref, owner.setTrigger]} />;
  },
  Content: (props: Omit<ComponentProps<typeof PopoverContent>, "class"> & { class?: string | undefined }) => {
    const owner = inside();
    const rest = omit(props, "class", "initialFocus", "finalFocus");

    return <PopoverContent {...rest} initialFocus={owner.initialTarget} finalFocus={owner.finalFocus()} class={["app-popover", props.class]} />;
  },
};
