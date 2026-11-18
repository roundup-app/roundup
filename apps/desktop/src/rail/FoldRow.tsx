import type { JSX } from "@solidjs/web";
import { copy } from "./copy";

/** U5483b: the label of a fold row, shared by the Rail's idle and internal branch and the Pads tab (U7499a). */
export const foldLabel = (count: number, group: "internal" | "idle"): string => `${count}${group === "internal" ? copy.internalCount : copy.idleCount}`;

/** The content of a fold row: its optional glyph, then its count and label. The Rail's row adds a status glyph, the Pads' has none. */
export const FoldContent = (props: { count: number; group: "internal" | "idle"; glyph?: JSX.Element }) => (
  <span class="rail-fold-content">{props.glyph}<span class="rail-fold-name">{foldLabel(props.count, props.group)}</span></span>
);
