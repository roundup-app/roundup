import { Tooltip as ArkTooltip } from "@ark-ui/solid/tooltip";
import { Show, splitProps } from "solid-js";
import type { Chord } from "../keys/chords";
import { KeyChip } from "../keys/KeyChip";
import "./Tooltip.css";

export const Tooltip = {
  ...ArkTooltip,
  Root: (props: ArkTooltip.RootProps) => <ArkTooltip.Root lazyMount unmountOnExit {...props} />,
  Content: (props: ArkTooltip.ContentProps & { chord?: Chord | undefined }) => {
    const [local, rest] = splitProps(props, ["chord", "children", "class"]);

    return <ArkTooltip.Content {...rest} class={`app-tooltip ${local.class ?? ""}`}>
      {local.children}<Show when={local.chord}>{(chord) => <span style={{ "margin-left": "var(--space-2)" }}><KeyChip keys={chord().keys} /></span>}</Show>
    </ArkTooltip.Content>;
  },
};
