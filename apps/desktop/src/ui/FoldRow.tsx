import type { JSX } from "@solidjs/web";

/** The content of a fold row: its optional glyph, then its label. The Rail's row adds a status glyph, the Pads' has none. */
export const FoldContent = (props: { label: string; glyph?: JSX.Element; /** The class stem of the row's own styles: the Pads tab's row is a Shelf row, not a Rail row, so the Rail's measurements and styles skip it. */ stem?: "rail-fold" | "pad-fold" }) => (
  <span class={`${props.stem ?? "rail-fold"}-content`}>{props.glyph}<span class={`${props.stem ?? "rail-fold"}-name`}>{props.label}</span></span>
);
