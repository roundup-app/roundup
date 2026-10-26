import { animate } from "motion";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { copy } from "../copy";
import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk } from "./glyph";

/** U401: one 12 px circle on the 16 px box; the more a Kind asks of the user, the more of it is filled. The marks inside a disc are `--ground`. */
const DRAWINGS = {
  ring: () => null,
  dashed: () => null,
  quarter: () => <path class="working-arc" d="M8 8V2A6 6 0 0 1 14 8Z" fill="currentColor" stroke="none" />,
  disc: () => <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />,
  cross: () => <path d="M5.5 5.5l5 5m0-5l-5 5" stroke="var(--ground)" fill="none" />,
  check: () => <path d="M5 8.2l2.2 2.2L11 6" stroke="var(--ground)" fill="none" />,
};

export const LABELS: Record<Kind, string> = { error: copy.error, "needs-you": copy.needsYouGlyph, blocked: copy.blocked, working: copy.working, idle: copy.idle, done: copy.done };

const SOLID = new Set(["cross", "check"]);

const Mark = (props: { kind: Kind; ref?: (svg: SVGSVGElement) => void; class?: string }) => (
  <svg ref={props.ref} class={props.class ?? "kind-mark"} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill={SOLID.has(glyphOf(props.kind).drawing) ? "currentColor" : "none"} stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="8" r="6" stroke-dasharray={glyphOf(props.kind).drawing === "dashed" ? "2.4 2.4" : undefined} />
    {DRAWINGS[glyphOf(props.kind).drawing]()}
  </svg>
);

/** M9: a Kind change on a mounted Glyph crossfades over the 150 ms fade preset; the latest Kind wins and the old mark is inert. */
export const KindGlyph = (props: { kind: Kind; decorative?: boolean; label?: string; class?: string }) => {
  const [leaving, setLeaving] = createSignal<Kind>();
  let current: SVGSVGElement | undefined;
  let running: { cancel(): void }[] = [];

  const fade = (outgoing: SVGSVGElement) => {
    const seconds = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--duration-reduced")) / 1000;

    if (!current || !(seconds > 0)) return setLeaving(undefined);
    const fades = [animate(current, { opacity: [0, 1] }, { duration: seconds, ease: "linear" }), animate(outgoing, { opacity: [1, 0] }, { duration: seconds, ease: "linear" })];

    running = fades;
    void fades[1]!.then(() => { if (running === fades) { setLeaving(undefined); running = []; } }, () => {});
  };

  const stop = () => { running.forEach(animation => animation.cancel()); running = []; };

  createEffect(on(() => props.kind, (_, previous) => {
    stop();
    setLeaving(previous);
  }, { defer: true }));

  onCleanup(stop);

  return (
    <span class={["glyph", hasInk(glyphOf(props.kind)) && "ink", props.class].filter(Boolean).join(" ")} data-state={props.decorative ? undefined : ""} data-tone={glyphOf(props.kind).tone} data-drawing={glyphOf(props.kind).drawing}
      role={props.decorative ? undefined : "img"} aria-label={props.decorative ? undefined : (props.label ?? LABELS[props.kind])} aria-hidden={props.decorative ? "true" : undefined}>
      <Mark kind={props.kind} ref={svg => { current = svg; }} />
      <Show when={leaving()}>{kind => <Mark kind={kind()} class="kind-mark kind-mark-leaving" ref={fade} />}</Show>
    </span>
  );
};
