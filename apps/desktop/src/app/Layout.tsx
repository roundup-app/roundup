import type { JSX } from "solid-js";

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
  overlay: JSX.Element;
}) => {
  const placement = () => props.shelfPlacement ?? SETTLED;

  return (
  <div class="window" data-shelf={placement().open ? "open" : "closed"}>
    <header class="header">{props.header}</header>
    <div class="columns">
      <section class="rail" aria-label="rail">
        {props.rail}
      </section>
      <section class="centre" aria-label="centre">
        {props.centre}
      </section>
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
  </div>
  );
};
