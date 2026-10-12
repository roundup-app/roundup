import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk } from "./glyph";

/** U401: one 12 px circle on the 16 px box; the more a Kind asks of the user, the more of it is filled. The marks inside a disc are `--ground`. */
const FILLS = {
  ring: () => null,
  dashed: () => null,
  quarter: () => <path d="M8 8V2A6 6 0 0 1 14 8Z" fill="currentColor" stroke="none" />,
  disc: () => <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />,
  cross: () => <path d="M5.5 5.5l5 5m0-5l-5 5" stroke="var(--ground)" fill="none" />,
  check: () => <path d="M5 8.2l2.2 2.2L11 6" stroke="var(--ground)" fill="none" />,
};

const SOLID = new Set(["cross", "check"]);

export const KindGlyph = (props: { kind: Kind; decorative?: boolean }) => (
  <span class={hasInk(glyphOf(props.kind)) ? "glyph ink" : "glyph"} data-tone={glyphOf(props.kind).tone} data-fill={glyphOf(props.kind).fill}
    role={props.decorative ? undefined : "img"} aria-label={props.decorative ? undefined : props.kind} aria-hidden={props.decorative ? "true" : undefined}>
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill={SOLID.has(glyphOf(props.kind).fill) ? "currentColor" : "none"} stroke="currentColor"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="8" r="6" stroke-dasharray={glyphOf(props.kind).fill === "dashed" ? "2.4 2.4" : undefined} />
      {FILLS[glyphOf(props.kind).fill]()}
    </svg>
  </span>
);
