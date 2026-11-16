import { makeEventListener } from "@solid-primitives/event-listener";
import type { ComponentProps, JSX } from "@solidjs/web";
import { isFocusFromKeyboard } from "@ui-sdk/core";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger, type TooltipProps } from "@ui-sdk/solid/tooltip";
import { createContext, createEffect, createSignal, omit, Show, useContext } from "solid-js";
import type { Chord } from "../keys/chords";
import { KeyHint } from "../keys/KeyHint";
import { createFloatingControl } from "./Dialog";
import { anchorBox } from "./anchorBox";
import "./Trigger.css";
import "./Tooltip.css";

const Owner = createContext<{ track: (element: HTMLElement) => void; show: () => void }>();

type RootProps = Omit<TooltipProps, "open" | "defaultOpen" | "onOpenChange"> & {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((details: { open: boolean }) => void) | undefined;
};

const Root = (props: RootProps) => {
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const control = createFloatingControl(props, trigger);
  let pointer: { x: number; y: number } | undefined;

  const track = (element: HTMLElement) => {
    const note = (event: PointerEvent) => { pointer = event.pointerType === "touch" ? undefined : { x: event.clientX, y: event.clientY }; };

    setTrigger(element);
    makeEventListener(element, "pointerenter", note, true);
    makeEventListener(element, "pointermove", note, true);
    makeEventListener(element, "focusin", () => { pointer = undefined; }, true);
  };

  // U6236a: a trigger that leaves the document with no replacement takes its open tooltip with it.
  createEffect(control.open, open => {
    if (!open) return;
    const watch = new MutationObserver(() => { if (!trigger()?.isConnected) control.change({ open: false }); });

    watch.observe(document.body, { childList: true, subtree: true });

    return () => watch.disconnect();
  });

  const show = () => {
    if (props.disabled) return;
    pointer = undefined;
    control.change({ open: true });
  };

  const rest = omit(props, "open", "defaultOpen", "onOpenChange", "disabled");

  return <Owner value={{ track, show }}>
    <UiTooltip {...rest} open={control.open()} disabled={props.disabled || control.blocked()}
      onOpenChange={open => {
        if (open && pointer && (import.meta.env.DEV || import.meta.env.VITEST === "true")) {
          const box = anchorBox(trigger());

          if (!box || pointer.x < box.left || pointer.x > box.right || pointer.y < box.top || pointer.y > box.bottom) {
            throw new Error("Tooltip anchor excludes its opening pointer");
          }
        }

        control.change({ open });
      }} />
  </Owner>;
};

export const Tooltip = {
  Root,
  Trigger: (props: ComponentProps<typeof TooltipTrigger>) => {
    const owner = useContext(Owner);

    return <TooltipTrigger {...props} ref={[props.ref, owner.track]} />;
  },
  /** The `onFocusIn` of a control enclosing the trigger: ui-sdk's focus open needs the trigger to contain the focused element, so the keyboard focus of an enclosing control opens the Tooltip here. */
  useEnclosingFocusIn: () => {
    const owner = useContext(Owner);

    return () => { if (isFocusFromKeyboard()) owner.show(); };
  },
  Content: (props: Omit<ComponentProps<typeof TooltipContent>, "class" | "children"> & { class?: string | undefined; chord?: Chord | undefined; children?: JSX.Element }) => {
    const rest = omit(props, "chord", "children", "class");

    return <TooltipContent {...rest} class={["app-tooltip", props.class]}>
      <Show when={props.chord} fallback={props.children}>{chord => <KeyHint chipAfter keys={chord().keys}>{props.children}</KeyHint>}</Show>
    </TooltipContent>;
  },
};
