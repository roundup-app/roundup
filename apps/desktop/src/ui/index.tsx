import { TreeView as ArkTreeView } from "@ark-ui/solid/tree-view";
import { Dialog as ArkDialog } from "@ark-ui/solid/dialog";
import { Editable as ArkEditable } from "@ark-ui/solid/editable";
import { Menu as ArkMenu } from "@ark-ui/solid/menu";
import { Tabs as ArkTabs, useTabsContext } from "@ark-ui/solid/tabs";
import { Tooltip as ArkTooltip } from "@ark-ui/solid/tooltip";
import { mergeProps, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import "./styles.css";

export const Dialog = {
  ...ArkDialog,
  Root: (props: ArkDialog.RootProps) => <ArkDialog.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkDialog.ContentProps) => <ArkDialog.Content {...props} class={`app-dialog ${props.class ?? ""}`} />,
};

/** A non-modal layer: Ark's dismissable layer stack without a scrim, a focus trap or an Escape close; the caller decides what an outside press does. */
export const Panel = {
  Root: (props: ArkDialog.RootProps) => (
    <ArkDialog.Root modal={false} closeOnEscape={false} closeOnInteractOutside={false} restoreFocus={false}
      initialFocusEl={() => (document.activeElement instanceof HTMLElement ? document.activeElement : document.body)}
      // The layer calls `preventDefault` on the Escape keydown itself; it is made a no-op so `esc` still reaches what has focus.
      onEscapeKeyDown={(event) => { event.preventDefault = () => undefined; }} {...props} />
  ),
  Content: ArkDialog.Content,
};

export const AlertDialog = {
  ...Dialog,
  Root: (props: ArkDialog.RootProps) => <Dialog.Root {...props} role="alertdialog" closeOnInteractOutside />,
};

export const Menu = {
  ...ArkMenu,
  Root: (props: ArkMenu.RootProps) => <ArkMenu.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkMenu.ContentProps) => <ArkMenu.Content {...props} class={`app-menu ${props.class ?? ""}`} />,
};

export const Editable = {
  ...ArkEditable,
  Root: (props: ArkEditable.RootProps) => <ArkEditable.Root selectOnFocus autoResize {...props} class={`app-editable ${props.class ?? ""}`} />,
};

export const Tooltip = {
  ...ArkTooltip,
  Root: (props: ArkTooltip.RootProps) => <ArkTooltip.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkTooltip.ContentProps) => <ArkTooltip.Content {...props} class={`app-tooltip ${props.class ?? ""}`} />,
};

export const Tabs = {
  ...ArkTabs,
  List: (props: ArkTabs.ListProps) => <ArkTabs.List {...props} class={`app-tabs-list ${props.class ?? ""}`} />,
  Trigger: (props: ArkTabs.TriggerProps) => {
    const tabs = useTabsContext();

    // Ark omits inactive controls links; keep every mounted panel linked using Ark's own content id.
    return <ArkTabs.Trigger aria-controls={tabs().getContentProps({ value: props.value }).id} data-button="quiet" {...props} class={`app-tabs-trigger ${props.class ?? ""}`} />;
  },
  Content: (props: ArkTabs.ContentProps) => <ArkTabs.Content {...props} class={`app-tabs-content ${props.class ?? ""}`} />,
};

export const IconButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { "aria-label": string }) => {
  const [local, rest] = splitProps(props, ["class", "onClick"]);

  const click: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (props["aria-disabled"] === true || props["aria-disabled"] === "true") {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const handler = local.onClick;

    if (!handler) return;

    if (0 in handler) handler[0](handler[1], event);
    else handler(event);
  };

  // Escape belongs to the surrounding App surface; blur and pointer leave dismiss the name.
  return <Tooltip.Root closeOnEscape={false} positioning={{ strategy: "fixed" }}>
    <Tooltip.Trigger asChild={(trigger) => <button {...trigger(mergeProps({ type: "button" as const }, rest, { onClick: click }))} data-button="icon" class={`word ${local.class ?? ""}`} />} />
    <Portal><Tooltip.Positioner><Tooltip.Content>{props["aria-label"]}</Tooltip.Content></Tooltip.Positioner></Portal>
  </Tooltip.Root>;
};

export const TreeView = {
  ...ArkTreeView,
  Tree: (props: ArkTreeView.TreeProps) => <ArkTreeView.Tree {...props} class={`app-tree ${props.class ?? ""}`} />,
};

// fallow-ignore-next-line unused-export -- todos/reorder.ts moves its import here in its own change (U535).
export { Sortable, swallowNextClick } from "./sortable";

export type { SortableMove, TreeRow } from "./sortable";

export { Splitter } from "./Splitter";

export { Select } from "./Select";

export { createToast, ToastProvider } from "./Toast";

export { Listbox } from "./Listbox";

export { Combobox } from "./Combobox";

export { Mentions } from "./Mentions";
