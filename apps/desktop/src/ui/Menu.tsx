import { captureFocus } from "../keys/focus";
import * as menu from "@zag-js/menu";
import { normalizeProps, useMachine } from "@zag-js/solid";
import { getInitialFocus } from "@zag-js/dom-query";
import { useLocaleContext } from "@ark-ui/solid/locale";
import { useEnvironmentContext } from "@ark-ui/solid/environment";
import { Menu as ArkMenu } from "@ark-ui/solid/menu";
import { createComputed, createContext, createMemo, createSignal, createUniqueId, on, splitProps, useContext } from "solid-js";
import { floatingControl } from "./Dialog";
import "./Menu.css";

const Owner = createContext<{ setElement: (element: HTMLElement) => void; setContent: (element: HTMLElement) => void }>();

export const Menu = {
  ...ArkMenu,
  Root: (props: ArkMenu.RootProps & { initialFocus?: ReturnType<typeof captureFocus> | undefined }) => {
    const [local, render, options] = splitProps(props, ["children", "initialFocus"], ["present", "onExitComplete", "onEnterComplete", "immediate", "lazyMount", "unmountOnExit"]);
    const [element, setElement] = createSignal<HTMLElement>();
    const control = floatingControl(props, element);
    const [content, setContent] = createSignal<HTMLElement>();
    let initialFocus = captureFocus();
    let opening = false;
    createComputed(on(control.open, open => {
      if (open) { initialFocus = local.initialFocus ?? captureFocus(true); opening = true; }
    }));
    const id = createUniqueId();
    const locale = useLocaleContext();
    const environment = useEnvironmentContext();

    const machine: typeof menu.machine = {
      ...menu.machine,
      implementations: {
        ...menu.machine.implementations,
        actions: {
          ...menu.machine.implementations?.actions,
          focusMenu: ({ scope }) => {
            const focus = opening ? initialFocus : captureFocus();
            opening = false;
            requestAnimationFrame(() => focus(() => {
              const target = getInitialFocus({
                root: content() ?? null, enabled: !content()?.contains(scope.getActiveElement()),
                filter: node => !node.role?.startsWith("menuitem"),
              });

              if (target) target.focus({ preventScroll: true });
            }));
          },
          focusTrigger: ({ context, event }) => {
            if (context.get("isSubmenu") || context.get("anchorPoint") || event.restoreFocus === false) return;
            const focus = captureFocus();
            queueMicrotask(() => focus(() => { if (element()?.isConnected) element()?.focus({ preventScroll: true }); }));
          },
        },
      },
    };

    const service = useMachine(machine, () => ({ id, dir: locale().dir, getRootNode: environment().getRootNode, ...options, loopFocus: props.loopFocus ?? false, closeOnSelect: props.closeOnSelect ?? true, composite: props.composite ?? true, typeahead: props.typeahead ?? true, positioning: props.positioning ?? {}, open: control.open(), onOpenChange: control.change }));
    const api = createMemo(() => menu.connect(service, normalizeProps));

    return <Owner.Provider value={{ setElement, setContent }}><ArkMenu.RootProvider lazyMount unmountOnExit {...render} value={{ api, service }}>
      {local.children}
    </ArkMenu.RootProvider></Owner.Provider>;
  },
  Trigger: (props: ArkMenu.TriggerProps) => {
    const owner = useContext(Owner);

    return <ArkMenu.Trigger {...props} ref={(element: HTMLButtonElement) => {
      owner?.setElement(element);

      // SAFETY: callers supply callback refs; Solid compiles element bindings into callbacks.
      (props.ref as ((element: HTMLButtonElement) => void) | undefined)?.(element);
    }} />;
  },
  ContextTrigger: (props: ArkMenu.ContextTriggerProps) => {
    const owner = useContext(Owner);

    return <ArkMenu.ContextTrigger {...props} ref={(element: HTMLButtonElement) => {
      owner?.setElement(element);

      // SAFETY: callers supply callback refs; Solid compiles element bindings into callbacks.
      (props.ref as ((element: HTMLButtonElement) => void) | undefined)?.(element);
    }} />;
  },
  Content: (props: ArkMenu.ContentProps) => {
    const owner = useContext(Owner);

    return <ArkMenu.Content {...props} ref={(element: HTMLDivElement) => {
      owner?.setContent(element);
      // SAFETY: callers supply callback refs; Solid compiles element bindings into callbacks.
      (props.ref as ((element: HTMLDivElement) => void) | undefined)?.(element);
    }} class={`app-menu ${props.class ?? ""}`} />;
  },
};
