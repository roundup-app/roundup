import type { JSX } from "@solidjs/web";

/** U5483b: the label of a fold row, shared by the Rail's idle and internal branch and the Pads tab (U7499a). */
export const foldLabel = (count: number, group: "internal" | "idle"): string => `${count}${group === "internal" ? " internal" : " idle"}`;

/** The content of a fold row: its optional glyph, then its count and label. The Rail's row adds a status glyph; the Pads' has none and names its label as a Shelf row's title, so D8 reads it as a Shelf row. */
export const FoldContent = (props: { count: number; group: "internal" | "idle"; glyph?: JSX.Element; shelf?: boolean }) => (
  <span class="rail-fold-content">{props.glyph}<span class={props.shelf ? "shelf-title" : "rail-fold-name"}>{foldLabel(props.count, props.group)}</span></span>
);
