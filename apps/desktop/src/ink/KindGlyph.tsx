import type { Kind } from "@contracts/Kind";
import type { JSX } from "solid-js";
import { glyphOf, hasInk } from "./glyph";
import type { Form } from "./glyph";

/** U396: a 16 px box with a 12 px live area. The solid shapes cut their `x` and `!` out with `evenodd`; the strokes are 1.75 px with round caps. */
const DRAWINGS: Record<Form, () => JSX.Element> = {
  "square-x": () => (
    <path fill="currentColor" fill-rule="evenodd" d="M5 2h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM8 6.586l2.093-2.093 1.414 1.414L9.414 8l2.093 2.093-1.414 1.414L8 9.414l-2.093 2.093-1.414-1.414L6.586 8 4.493 5.907l1.414-1.414z" />
  ),
  "disc-bang": () => <path fill="currentColor" fill-rule="evenodd" d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM7 4.5h2V9H7zM7 10.5h2v2H7z" />,
  bars: () => <path fill="none" stroke="currentColor" d="M5.5 4v8M10.5 4v8" />,
  arc: () => <path fill="none" stroke="currentColor" d="M8 3a5 5 0 1 1-5 5" />,
  dot: () => <circle cx="8" cy="8" r="2" fill="currentColor" />,
  check: () => <path fill="none" stroke="currentColor" d="M3.5 8.5l3 3 6-7" />,
};

export const KindGlyph = (props: { kind: Kind; decorative?: boolean }) => (
  <span class={hasInk(glyphOf(props.kind)) ? "glyph ink" : "glyph"} data-tone={glyphOf(props.kind).tone} data-form={glyphOf(props.kind).form}
    role={props.decorative ? undefined : "img"} aria-label={props.decorative ? undefined : props.kind} aria-hidden={props.decorative ? "true" : undefined}>
    <svg class="icon" aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      {DRAWINGS[glyphOf(props.kind).form]()}
    </svg>
  </span>
);
