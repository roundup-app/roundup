import { Splitter } from "../ui";
import type { Side } from "./widths";

/** U389, U390, U502: the Resize edge between a region and the centre pane. Ark's Splitter owns drag, keys and cancel; each action ends in one `commit`. */
export const ResizeEdge = (props: { side: Side; class?: string; onDragging?: (on: boolean) => void }) => (
  <Splitter side={props.side} class={props.class} onDragging={props.onDragging} />
);
