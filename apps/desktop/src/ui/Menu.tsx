import { captureFocus } from "../keys/focus";
import type { ComponentProps } from "@solidjs/web";
import { Menu as UiMenu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuItemIndicator, MenuRadioGroup, MenuRadioItem, MenuTrigger, type MenuOpenChangeReason, type MenuProps } from "@ui-sdk/solid/menu";
import { createContext, createEffect, createSignal, omit, untrack, useContext } from "solid-js";
import { createFloatingControl } from "./Dialog";
import { trackSurface } from "./openSurfaces";
import "./Trigger.css";
import "./Menu.css";

const Owner = createContext<{ setTrigger: (element: HTMLElement) => void; opened: (content: HTMLElement) => void; returnFocus: () => HTMLElement }>();

type RootProps = Omit<MenuProps, "open" | "defaultOpen" | "onOpenChange"> & {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((details: { open: boolean }) => void) | undefined;
  initialFocus?: ReturnType<typeof captureFocus> | undefined;
  /** Where focus goes when the menu closes for `reason`; no element returns it to the trigger. */
  finalFocusEl?: ((reason: MenuOpenChangeReason | undefined) => HTMLElement | null | undefined) | undefined;
};

const Root = (props: RootProps) => {
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const control = createFloatingControl(props, trigger);
  trackSurface(control.open);
  let permission = captureFocus();

  createEffect(control.open, open => { if (!open) permission = captureFocus(); });

  // A menu opened by its `open` prop has no trigger press that focuses its content: focus follows only while no other focus choice has been made.
  // The content mounts before this open's writes are readable, so the permission is read once the frame has flushed them.
  const opened = (content: HTMLElement) => {
    requestAnimationFrame(() => (props.initialFocus ?? permission)(() => { if (!content.contains(document.activeElement)) content.focus({ preventScroll: true }); }));
  };

  const rest = omit(props, "open", "defaultOpen", "onOpenChange", "initialFocus", "finalFocusEl", "loop");

  let closedBy: MenuOpenChangeReason | undefined;

  // After an item runs, the library returns focus to the trigger, or where `finalFocusEl` names. That move is the library's own: a permission its action captured before it, such as the focus a new row asks for, still holds.
  const returnFocus = () => captureFocus().target(() => untrack(() => props.finalFocusEl?.(closedBy) ?? trigger()));

  return <Owner value={{ setTrigger, opened, returnFocus }}>
    <UiMenu {...rest} loop={props.loop ?? false} open={control.open()} onOpenChange={(open, details) => { closedBy = details.reason; control.change({ open }); }} />
  </Owner>;
};

const Trigger = (props: ComponentProps<typeof MenuTrigger>) => {
  const owner = useContext(Owner);

  return <MenuTrigger {...props} ref={[props.ref, owner.setTrigger]} />;
};

const Content = (props: Omit<ComponentProps<typeof MenuContent>, "class"> & { class?: string | undefined }) => {
  const owner = useContext(Owner);
  const rest = omit(props, "class", "ref");

  return <MenuContent finalFocus={owner.returnFocus} {...rest} ref={[props.ref, owner.opened]} class={["app-menu", props.class]} />;
};

export const Menu = { Root, Trigger, Content, Item: MenuItem, Group: MenuGroup, GroupLabel: MenuGroupLabel, RadioGroup: MenuRadioGroup, RadioItem: MenuRadioItem, ItemIndicator: MenuItemIndicator };
