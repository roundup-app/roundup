import { onCleanup } from "solid-js";
import type { Side } from "./widths";

const STEP = 16;

const LEAP = 64;

/** U389, U390: the Resize edge, a focusable separator between a region and the centre pane. Drag, keys and reset all end in one `commit`; a drag writes style once per frame and commits on `pointerup`. */
export const ResizeEdge = (props: { side: Side; class?: string; onDragging?: (on: boolean) => void }) => {
  let edge: HTMLDivElement | undefined;
  let stop: (() => void) | undefined;

  const commit = (px: number) => props.side.commit(px);

  const begin = (press: PointerEvent) => {
    if (press.button !== 0 || !edge) return;

    const from = props.side.now();
    let target = from;
    let frame: number | null = null;

    press.preventDefault();
    edge.focus({ preventScroll: true });
    edge.setPointerCapture?.(press.pointerId);
    props.onDragging?.(true);

    const draw = () => {
      frame = null;
      props.side.preview(target);
    };

    const move = (event: PointerEvent) => {
      target = from + props.side.direction * (event.clientX - press.clientX);
      frame ??= requestAnimationFrame(draw);
    };

    const end = (keep: boolean) => {
      stop?.();

      if (frame !== null) cancelAnimationFrame(frame);

      if (keep) {
        props.side.preview(target);
        commit(target);
      } else {
        props.side.preview(from);
      }

      props.onDragging?.(false);
    };

    const up = () => end(true);

    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.stopPropagation();
      end(false);
    };

    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", up);
    edge.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key, true);

    const element = edge;

    stop = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key, true);
      stop = undefined;
    };
  };

  onCleanup(() => stop?.());

  const press = (event: KeyboardEvent) => {
    const { side } = props;

    const sign = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;

    if (sign !== 0) commit(side.now() + side.direction * sign * (event.shiftKey ? LEAP : STEP));
    else if (event.key === "Home") commit(side.min);
    else if (event.key === "End") commit(Number.MAX_SAFE_INTEGER);
    else if (event.key === "Enter") commit(side.fallback);
    else return;

    event.preventDefault();
  };

  return (
    <div
      ref={edge}
      class={`resize-edge ${props.class ?? ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.side.label}
      aria-valuenow={Math.round(props.side.now())}
      aria-valuemin={props.side.min}
      aria-valuemax={Math.round(props.side.room())}
      tabindex="0"
      onPointerDown={begin}
      onKeyDown={press}
      onDblClick={() => commit(props.side.fallback)}
    />
  );
};
