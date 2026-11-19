import type { JSX } from "@solidjs/web";

/** U5483b: the label of a fold row, shared by the Rail's idle and internal branch and the Pads tab (U7499a). */
export const foldLabel = (count: number, group: "internal" | "idle"): string => `${count}${group === "internal" ? " internal" : " idle"}`;

/** The content of a fold row: its optional glyph, then its count and label. The Rail's row adds a status glyph, the Pads' has none. */
export const FoldContent = (props: { count: number; group: "internal" | "idle"; glyph?: JSX.Element; /** The class stem of the row's own styles: the Pads tab's row is a Shelf row, not a Rail row, so the Rail's measurements and styles skip it. */ stem?: "rail-fold" | "pad-fold" }) => (
  <span class={`${props.stem ?? "rail-fold"}-content`}>{props.glyph}<span class={`${props.stem ?? "rail-fold"}-name`}>{foldLabel(props.count, props.group)}</span></span>
);
