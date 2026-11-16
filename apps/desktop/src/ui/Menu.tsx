import { captureFocus } from "../keys/focus";
import type { ComponentProps } from "@solidjs/web";
import { Menu as UiMenu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuItemIndicator, MenuRadioGroup, MenuRadioItem, MenuTrigger, type MenuProps } from "@ui-sdk/solid/menu";
import { createContext, createEffect, createSignal, omit, useContext } from "solid-js";
import { createFloatingControl } from "./Dialog";
import { trackSurface } from "./openSurfaces";
import "./Trigger.css";
import "./Menu.css";

const Owner = createContext<{ setTrigger: (element: HTMLElement) => void; opened: (content: HTMLElement) => void }>();

type RootProps = Omit<MenuProps, "open" | "defaultOpen" | "onOpenChange"> & {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((details: { open: boolean }) => void) | undefined;
  initialFocus?: ReturnType<typeof captureFocus> | undefined;
};

const Root = (props: RootProps) => {
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const control = createFloatingControl(props, trigger);
  trackSurface(control.open);
  let permission = captureFocus();

  createEffect(control.open, open => { if (!open) permission = captureFocus(); });

  // A menu opened by its `open` prop has no trigger press that focuses its content: focus follows only while no other focus choice has been made.
  const opened = (content: HTMLElement) => {
    const focus = props.initialFocus ?? permission;

    requestAnimationFrame(() => focus(() => { if (!content.contains(document.activeElement)) content.focus({ preventScroll: true }); }));
  };

  const rest = omit(props, "open", "defaultOpen", "onOpenChange", "initialFocus", "loop");

  return <Owner value={{ setTrigger, opened }}>
    <UiMenu {...rest} loop={props.loop ?? false} open={control.open()} onOpenChange={open => control.change({ open })} />
  </Owner>;
};

const Trigger = (props: ComponentProps<typeof MenuTrigger>) => {
  const owner = useContext(Owner);

  return <MenuTrigger {...props} ref={[props.ref, owner.setTrigger]} />;
};

const Content = (props: Omit<ComponentProps<typeof MenuContent>, "class"> & { class?: string | undefined }) => {
  const owner = useContext(Owner);
  const rest = omit(props, "class", "ref");

  return <MenuContent {...rest} ref={[props.ref, owner.opened]} class={["app-menu", props.class]} />;
};

export const Menu = { Root, Trigger, Content, Item: MenuItem, Group: MenuGroup, GroupLabel: MenuGroupLabel, RadioGroup: MenuRadioGroup, RadioItem: MenuRadioItem, ItemIndicator: MenuItemIndicator };
