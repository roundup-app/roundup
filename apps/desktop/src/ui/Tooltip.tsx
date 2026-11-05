import { Tooltip as ArkTooltip, useTooltipContext } from "@ark-ui/solid/tooltip";
import { floatingControl } from "./Dialog";
import { anchorBox } from "./anchorBox";
import { createContext, createEffect, createSignal, onCleanup, Show, splitProps, useContext } from "solid-js";
import type { Chord } from "../keys/chords";
import { KeyHint } from "../keys/KeyHint";
import "./Tooltip.css";

type Anchor = () => HTMLElement | undefined;

const Ownership = createContext<{ pointer: (event: PointerEvent, id: string | undefined) => void; focus: (event: FocusEvent, id: string | undefined) => void }>();

const Root = (props: ArkTooltip.RootProps & { anchor?: Anchor | undefined }) => {
  const [owner, setOwner] = createSignal<HTMLElement>();
  const control = floatingControl(props, () => props.anchor?.() ?? owner());
  let pointer: { x: number; y: number } | undefined;
  let ownerId: string | undefined;
  // U6236a: a re-render replaces the trigger's element; its id finds the replacement.
  const rect = () => props.anchor ? anchorBox(props.anchor()) : anchorBox(owner(), () => ownerId ? document.getElementById(ownerId) : null);

  const ownership = {
    pointer: (event: PointerEvent, id: string | undefined) => {
      if (event.pointerType === "touch") return;
      ownerId = id;
      setOwner(event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined);
      pointer = { x: event.clientX, y: event.clientY };
    },
    focus: (event: FocusEvent, id: string | undefined) => {
      const current = event.currentTarget;
      ownerId = id;

      setOwner(current instanceof HTMLElement ? (id ? current.ownerDocument.getElementById(id) : null) ?? current : undefined);
      pointer = undefined;
    },
  };

  createEffect(() => {
    if (!control.open()) return;
    const watch = new MutationObserver(() => { if (!rect()) control.change({ open: false }); });

    watch.observe(document.body, { childList: true, subtree: true });
    onCleanup(() => watch.disconnect());
  });

  return <Ownership.Provider value={ownership}><ArkTooltip.Root lazyMount unmountOnExit {...props}
    open={control.open()} disabled={props.disabled || control.blocked()}
    positioning={{ strategy: "fixed", ...props.positioning, getAnchorRect: rect }}
    onOpenChange={(details) => {
      if (details.open && pointer && (import.meta.env.DEV || import.meta.env.VITEST === "true")) {
        const box = rect();

        if (!box || pointer.x < box.left || pointer.x > box.right || pointer.y < box.top || pointer.y > box.bottom) {
          throw new Error("Tooltip anchor excludes its opening pointer");
        }
      }

      control.change(details);
    }} /></Ownership.Provider>;
};

export const Tooltip = {
  ...ArkTooltip,
  Root,
  Trigger: (props: ArkTooltip.TriggerProps) => {
    const ownership = useContext(Ownership);
    const tooltip = useTooltipContext();
    const [triggerProps] = splitProps(props, ["value"]);

    const id = () => tooltip().getTriggerProps(triggerProps).id;
    const pointer = (event: PointerEvent) => ownership?.pointer(event, id());

    return <ArkTooltip.Trigger {...props} onPointerMove={pointer} onPointerOver={pointer} onFocusIn={(event) => ownership?.focus(event, id())} />;
  },
  Content: (props: ArkTooltip.ContentProps & { chord?: Chord | undefined }) => {
    const [local, rest] = splitProps(props, ["chord", "children", "class"]);

    return <ArkTooltip.Content {...rest} class={`app-tooltip ${local.class ?? ""}`}>
      <Show when={local.chord} fallback={local.children}>{(chord) => <KeyHint chipAfter keys={chord().keys}>{local.children}</KeyHint>}</Show>
    </ArkTooltip.Content>;
  },
};
