import { captureFocus } from "../keys/focus";
import { Popover as ArkPopover } from "@ark-ui/solid/popover";
import { createComputed, createContext, createSignal, on, useContext } from "solid-js";
import { dialogOwned, floatingControl } from "./Dialog";
import "./Popover.css";

const Owner = createContext<(element: HTMLElement) => void>();

/** A popover that never takes the keyboard on opening and closes on outside interaction or a modal opening. */
export const Popover = {
  ...ArkPopover,
  Root: (props: ArkPopover.RootProps) => {
    const [element, setElement] = createSignal<HTMLElement>();
    const control = floatingControl(props, element);
    let initialFocus = captureFocus();
    let finalFocus = captureFocus();

    createComputed(on(control.open, open => {
      if (open) initialFocus = captureFocus();
      else finalFocus = captureFocus();
    }));

    return <Owner.Provider value={setElement}><ArkPopover.Root lazyMount unmountOnExit autoFocus={false} modal={false} closeOnEscape={false} {...props} open={control.open()} onOpenChange={control.change}
      initialFocusEl={() => {
        let target: HTMLElement | null | false = false;
        initialFocus(() => { target = props.initialFocusEl?.() ?? null; });

        return target;
      }} finalFocusEl={() => {
        let target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
        finalFocus(() => { target = props.finalFocusEl?.() ?? element() ?? target; });

        return target;
      }} /></Owner.Provider>;
  },
  Trigger: (props: ArkPopover.TriggerProps) => {
    const setElement = useContext(Owner);

    return <ArkPopover.Trigger {...props} ref={(element: HTMLButtonElement) => {
      setElement?.(element);

      // SAFETY: callers supply callback refs; Solid compiles element bindings into callbacks.
      (props.ref as ((element: HTMLButtonElement) => void) | undefined)?.(element);
    }} />;
  },
  Anchor: (props: ArkPopover.AnchorProps) => {
    const setElement = useContext(Owner);

    return <ArkPopover.Anchor {...props} ref={(element: HTMLDivElement) => {
      setElement?.(element);

      // SAFETY: callers supply callback refs; Solid compiles element bindings into callbacks.
      (props.ref as ((element: HTMLDivElement) => void) | undefined)?.(element);
    }} />;
  },
  Content: (props: ArkPopover.ContentProps) => <ArkPopover.Content {...props} data-dialog-owned={dialogOwned() || undefined} class={`app-popover ${props.class ?? ""}`} />,
};
