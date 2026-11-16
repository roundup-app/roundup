import { bindLayer } from "@ui-sdk/core";
import { createContext, createEffect, createMemo, createSignal, omit, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";

type RootProps = { open: boolean; onPointerDownOutside: (event: Event) => void; persistentElements?: (() => Element | null)[]; children?: JSX.Element };

const PanelContext = createContext<RootProps | null>(null);

/** The Panel primitive: a non-modal layer in the shared layer stack, without a scrim, a focus trap or an Escape close; the caller decides what an outside press does. */
export const Panel = {
  Root: (props: RootProps) => <PanelContext value={props}>{props.children}</PanelContext>,
  Content: (props: JSX.HTMLAttributes<HTMLDivElement>) => {
    const root = useContext(PanelContext);

    if (!root) throw new Error("A Panel's content renders inside its Root.");

    const [element, setElement] = createSignal<HTMLElement>();

    // A memo: binding again would move the layer above a modal that opened since.
    const shown = createMemo(() => root.open);

    createEffect(() => [shown(), element()] as const, ([open, panel]) => {
      if (!open || !panel) return;

      return bindLayer(panel, {
        contains: (node) => root.persistentElements?.some((persistent) => persistent()?.contains(node)) ?? false,
        onDismiss: (reason, event) => { if (reason === "outside-press") root.onPointerDownOutside(event); },
      });
    });

    const rest = omit(props, "ref");

    return <div {...rest} ref={(panel: HTMLElement) => {
      setElement(panel);
      // SAFETY: every caller passes a callback ref; the prop is typed as the union Solid allows.
      (props.ref as ((element: HTMLElement) => void) | undefined)?.(panel);
    }} />;
  },
};
