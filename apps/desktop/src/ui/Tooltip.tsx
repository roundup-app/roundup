import { Tooltip as ArkTooltip, useTooltipContext } from "@ark-ui/solid/tooltip";
import { createContext, Show, splitProps, useContext } from "solid-js";
import type { Chord } from "../keys/chords";
import { KeyHint } from "../keys/KeyHint";
import "./Tooltip.css";

type Anchor = () => HTMLElement | undefined;

const Ownership = createContext<{ pointer: (event: PointerEvent) => void; focus: (event: FocusEvent, id: string | undefined) => void }>();

const Root = (props: ArkTooltip.RootProps & { anchor?: Anchor | undefined }) => {
  let owner: HTMLElement | undefined;
  let pointer: { x: number; y: number } | undefined;
  const rect = () => (props.anchor ? props.anchor() : owner)?.getBoundingClientRect() ?? null;

  const ownership = {
    pointer: (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      owner = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
      pointer = { x: event.clientX, y: event.clientY };
    },
    focus: (event: FocusEvent, id: string | undefined) => {
      const current = event.currentTarget;

      owner = current instanceof HTMLElement ? (id ? current.ownerDocument.getElementById(id) : null) ?? current : undefined;
      pointer = undefined;
    },
  };

  return <Ownership.Provider value={ownership}><ArkTooltip.Root lazyMount unmountOnExit {...props}
    positioning={{ strategy: "fixed", ...props.positioning, getAnchorRect: rect }}
    onOpenChange={(details) => {
      if (details.open && pointer && (import.meta.env.DEV || import.meta.env.VITEST === "true")) {
        const box = rect();

        if (!box || pointer.x < box.left || pointer.x > box.right || pointer.y < box.top || pointer.y > box.bottom) {
          throw new Error("Tooltip anchor excludes its opening pointer");
        }
      }

      props.onOpenChange?.(details);
    }} /></Ownership.Provider>;
};

export const Tooltip = {
  ...ArkTooltip,
  Root,
  Trigger: (props: ArkTooltip.TriggerProps) => {
    const ownership = useContext(Ownership);
    const tooltip = useTooltipContext();
    const [triggerProps] = splitProps(props, ["value"]);

    return <ArkTooltip.Trigger {...props} onPointerMove={ownership?.pointer} onPointerOver={ownership?.pointer} onFocusIn={(event) => ownership?.focus(event, tooltip().getTriggerProps(triggerProps).id)} />;
  },
  Content: (props: ArkTooltip.ContentProps & { chord?: Chord | undefined }) => {
    const [local, rest] = splitProps(props, ["chord", "children", "class"]);

    return <ArkTooltip.Content {...rest} class={`app-tooltip ${local.class ?? ""}`}>
      <Show when={local.chord} fallback={local.children}>{(chord) => <KeyHint chipAfter keys={chord().keys}>{local.children}</KeyHint>}</Show>
    </ArkTooltip.Content>;
  },
};
