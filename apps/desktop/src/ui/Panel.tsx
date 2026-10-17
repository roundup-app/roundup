import { Dialog as ArkDialog } from "@ark-ui/solid/dialog";

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
