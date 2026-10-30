import { animate } from "motion";
import { createComputed, createEffect, createSignal, on, onCleanup, Show, useContext } from "solid-js";
import { createReducedMotion, ReducedMotionContext } from "../app/reducedMotion";
import { copy } from "../copy";
import type { Kind } from "@contracts/Kind";
import { glyphOf, hasInk } from "./glyph";

const curve = (tokens: CSSStyleDeclaration, name: string): [number, number, number, number] => {
  const values = tokens.getPropertyValue(name).match(/[\d.]+/g) ?? [];

  return [Number(values[0]), Number(values[1]), Number(values[2]), Number(values[3])];
};

/** M9/M10: only the current working arc turns; an outgoing arc keeps its displayed angle. */
const WorkingArc = (props: { frozen?: string | undefined }) => {
  let path!: SVGPathElement;
  let turned = false;

  const reduced = props.frozen === undefined
    ? useContext(ReducedMotionContext) ?? (window.matchMedia ? createReducedMotion(query => window.matchMedia(query)) : () => true)
    : () => true;

  createEffect(() => {
    if (props.frozen !== undefined) {
      path.style.transform = props.frozen;

      return;
    }

    const tokens = getComputedStyle(document.documentElement);

    if (reduced()) {
      if (turned) {
        const fade = animate(path, { opacity: [0, 1] }, { duration: parseFloat(tokens.getPropertyValue("--duration-reduced")) / 1000, ease: curve(tokens, "--easing-glyph-in") });

        onCleanup(() => fade.cancel());
      }

      return;
    }

    const duration = tokens.getPropertyValue("--duration-working").trim();
    const seconds = parseFloat(duration) / (duration.endsWith("ms") ? 1000 : 1);

    if (!(seconds > 0)) return;
    const turn = animate(path, { transform: ["rotate(0deg)", "rotate(360deg)"] }, { duration: seconds, ease: curve(tokens, "--easing-working"), repeat: Infinity });

    turned = true;
    onCleanup(() => turn.cancel());
  });

  return <path ref={element => { path = element; }} class="working-arc" d="M8 8V2A6 6 0 0 1 14 8Z" fill="currentColor" stroke="none" />;
};

/** U401: one 12 px circle on the 16 px box; the more a Kind asks of the user, the more of it is filled. The marks inside a disc are `--ground`. */
const DRAWINGS = {
  ring: () => null,
  barred: () => <path d="M2 8h12" />,
  quarter: (frozen?: string) => <WorkingArc frozen={frozen} />,
  disc: () => <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />,
  cross: () => <path d="M5.5 5.5l5 5m0-5l-5 5" stroke="var(--ground)" fill="none" />,
  check: () => <path d="M5 8.2l2.2 2.2L11 6" stroke="var(--ground)" fill="none" />,
};

export const LABELS: Record<Kind, string> = { error: copy.error, "needs-you": copy.needsYouGlyph, blocked: copy.blocked, working: copy.working, idle: copy.idle, done: copy.done };

const SOLID = new Set(["cross", "check"]);

const Mark = (props: { kind: Kind; frozen?: string; ref?: (svg: SVGSVGElement) => void; class?: string }) => (
  <svg ref={props.ref} class={props.class ?? "kind-mark"} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill={SOLID.has(glyphOf(props.kind).drawing) ? "currentColor" : "none"} stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="8" cy="8" r="6" />
    {DRAWINGS[glyphOf(props.kind).drawing](props.frozen)}
  </svg>
);

/** M9: a Kind change on a mounted Glyph crossfades over the 150 ms fade preset; the latest Kind wins and the old mark is inert. */
export const KindGlyph = (props: { kind: Kind; decorative?: boolean; label?: string; class?: string }) => {
  const [leaving, setLeaving] = createSignal<{ kind: Kind; from: number; turn: string }>();
  let current: SVGSVGElement | undefined;
  let outgoing: HTMLElement | undefined;
  let running: { cancel(): void }[] = [];
  let shown = props.kind;

  const stop = () => { running.forEach(animation => animation.cancel()); running = []; };

  // A computation runs before Solid redraws the Mark, so the working arc is still in the DOM to read.
  createComputed(on(() => props.kind, kind => {
    const previous = shown;

    shown = kind;
    // Read what is on screen before the running fade is cancelled, so an interrupted fade continues from it.
    const from = current ? parseFloat(getComputedStyle(current).opacity) || 1 : 1;
    const turn = current?.querySelector(".working-arc") ? getComputedStyle(current.querySelector(".working-arc")!).transform : "none";

    stop();
    setLeaving({ kind: previous, from, turn });
  }, { defer: true }));

  createEffect(on(leaving, mark => {
    const tokens = getComputedStyle(document.documentElement);
    const seconds = parseFloat(tokens.getPropertyValue("--duration-reduced")) / 1000;

    if (!mark || !outgoing || !current) return;

    if (!(seconds > 0)) return setLeaving(undefined);
    // Opaque marks stacked: an eased pair keeps the combined Glyph from dimming at the midpoint.
    const fades = [animate(current, { opacity: [0, 1] }, { duration: seconds, ease: curve(tokens, "--easing-glyph-in") }), animate(outgoing, { opacity: [mark.from, 0] }, { duration: seconds, ease: curve(tokens, "--easing-glyph-out") })];

    running = fades;
    void fades[1]!.then(() => { if (running === fades) { setLeaving(undefined); running = []; } }, () => {});
  }, { defer: true }));

  onCleanup(stop);

  return (
    <span class={["glyph", hasInk(glyphOf(props.kind)) && "ink", props.class].filter(Boolean).join(" ")} data-state={props.decorative ? undefined : ""} data-tone={glyphOf(props.kind).tone} data-drawing={glyphOf(props.kind).drawing}
      role={props.decorative ? undefined : "img"} aria-label={props.decorative ? undefined : (props.label ?? LABELS[props.kind])} aria-hidden={props.decorative ? "true" : undefined}>
      <Mark kind={props.kind} ref={svg => { current = svg; }} />
      <Show when={leaving()} keyed>{mark => (
        <span ref={el => { outgoing = el; }} class={["kind-mark-leaving", hasInk(glyphOf(mark.kind)) && "ink"].filter(Boolean).join(" ")} data-tone={glyphOf(mark.kind).tone}>
          <Mark kind={mark.kind} frozen={mark.turn} />
        </span>
      )}</Show>
    </span>
  );
};
