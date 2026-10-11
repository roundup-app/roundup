import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { ResizeEdge } from "../resize/ResizeEdge";
import { setRailDragging } from "../resize/dragging";
import type { Widths } from "../resize/widths";

/** How the Shelf sits (U369 to U371): in the layout or not, slid in or out, and whether a change slides. */
export type ShelfPlacement = { open: boolean; rendered: boolean; shown: boolean; animated: boolean; onSettle: () => void };

const SETTLED: ShelfPlacement = { open: true, rendered: true, shown: true, animated: false, onSettle: () => {} };

/** Rail left, centre right; nesting and columns are never drawn as boxes. The Shelf and the overlay float over the window and the centre; the Shelf spans the window's full height. */
export const Layout = (props: {
  header: JSX.Element;
  rail: JSX.Element;
  centre: JSX.Element;
  shelf: JSX.Element;
  shelfPlacement?: ShelfPlacement;
  /** U389, U390: the Rail's and Shelf's widths; without them the Tokens' defaults apply and no Resize edge shows. */
  widths?: Widths;
  overlay: JSX.Element;
}) => {
  const placement = () => props.shelfPlacement ?? SETTLED;

  return (
  <div class="window" ref={(element) => props.widths?.attach(element)} style={props.widths?.style()} data-shelf={placement().open ? "open" : "closed"}>
    <header class="header">{props.header}</header>
    <div class="columns">
      <section class="rail" aria-label="rail">
        {props.rail}
      </section>
      <section class="centre" aria-label="centre">
        {props.centre}
      </section>
      <Show when={props.widths}>{(widths) => <ResizeEdge class="rail-edge" side={widths().rail} onDragging={setRailDragging} />}</Show>
    </div>
    <div class="overlay">{props.overlay}</div>
    <section
      class="shelf"
      aria-label="shelf"
      data-open={placement().shown}
      data-animated={placement().animated}
      hidden={!placement().rendered}
      inert={!placement().open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "transform") placement().onSettle();
      }}
    >
      {props.shelf}
    </section>
    <Show when={props.widths}>
      {(widths) => (
        <div
          class="shelf-edge-slot"
          data-open={placement().shown}
          data-animated={placement().animated}
          hidden={!placement().rendered}
          inert={!placement().open}
        >
          <ResizeEdge class="shelf-edge" side={widths().shelf} />
        </div>
      )}
    </Show>
  </div>
  );
};
