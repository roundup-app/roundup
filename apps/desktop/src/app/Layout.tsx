import { copy } from "../copy";
import { createEffect, createSignal, on, onCleanup, onMount, Show, splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { ResizeEdge } from "../resize/ResizeEdge";
import { setShelfSliding } from "../shelf/sliding";
import { setResizeDragging } from "../resize/dragging";
import type { Widths } from "../resize/widths";

/** How the Shelf sits (U369 to U371): in the layout or not, slid in or out, and whether a change slides. */
export type ShelfPlacement = { open: boolean; rendered: boolean; shown: boolean; animated: boolean; onClose?: () => void; onSettle: () => void };

const SETTLED: ShelfPlacement = { open: true, rendered: true, shown: true, animated: false, onSettle: () => {} };

/** Rail left, centre right; nesting and columns are never drawn as boxes. The Shelf reserves the centre when it has room; the overlay floats over both; every region starts below the window bar. */
export const Layout = (props: {
  header: JSX.Element;
  contentActions?: JSX.Element;
  rail: JSX.Element;
  centre: JSX.Element;
  shelf: JSX.Element;
  shelfPlacement?: ShelfPlacement;
  /** U389, U390: the Rail's and Shelf's widths; without them the Tokens' defaults apply and no Resize edge shows. */
  widths?: Widths;
  /** #2003: bind Ark getRootProps/getPanelProps to the actual measured window and
   * owned regions. Layout retains styles, classes, visibility and transitions;
   * the adapter retains identity, ownership, events and element refs. */
  splitter?: Partial<Record<"root" | "rail" | "centre" | "shelf", Omit<JSX.HTMLAttributes<HTMLElement>, "ref"> & { ref?: (element: HTMLElement) => void }>>;
  overlay: JSX.Element;
}) => {
  const binding = (part: "root" | "rail" | "centre" | "shelf") => {
    const [, attributes] = splitProps(props.splitter?.[part] ?? {}, ["style", "class", "classList", "children", "ref"]);

    return attributes;
  };

  const attach = (part: "root" | "rail" | "centre" | "shelf", element: HTMLElement) => {
    const ref = props.splitter?.[part]?.ref;

    ref?.(element);
  };

  const placement = () => props.shelfPlacement ?? SETTLED;

  let windowElement: HTMLDivElement | undefined;
  const [mode, setMode] = createSignal<"reserved" | "overlay">("reserved");

  const measure = () => {
    if (!windowElement || windowElement.clientWidth === 0) return;
    const style = getComputedStyle(windowElement);
    const available = windowElement.clientWidth - parseFloat(style.getPropertyValue("--rail-width")) - parseFloat(style.getPropertyValue("--shelf-span"));
    setMode(available < parseFloat(style.getPropertyValue("--centre-min-width")) ? "overlay" : "reserved");
  };

  // ResizeObserver sees previews as well as committed and restored panel widths.
  onMount(() => {
    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);

    for (const element of [windowElement, windowElement?.querySelector(".rail"), windowElement?.querySelector(".shelf")]) {
      if (element) observer.observe(element);
    }

    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    props.widths?.style();
    measure();
  });
  createEffect(on(() => placement().shown, () => {
    const drawer = windowElement?.querySelector('.drawer[data-open="true"]');
    setShelfSliding(!drawer && mode() === "reserved" && placement().animated && placement().rendered);
  }, { defer: true }));
  onCleanup(() => setShelfSliding(false));

  return (
  <div {...binding("root")} class="window" ref={(element) => { attach("root", element); windowElement = element; props.widths?.attach(element); }} style={props.widths?.style()} data-shelf={placement().open ? "open" : "closed"} data-shelf-mode={mode()} data-shelf-shown={placement().shown} data-shelf-animated={placement().animated}>
    <header class="header">{props.header}</header>
    <div class="content-actions">{props.contentActions}</div>
    <div class="columns" onTransitionEnd={(event) => { if (event.target === event.currentTarget && event.propertyName === "width") setShelfSliding(false); }}>
      <section {...binding("rail")} ref={(element) => attach("rail", element)} class="rail" aria-label={copy.rail}>
        {props.rail}
      </section>
      <section {...binding("centre")} ref={(element) => attach("centre", element)} class="centre" aria-label={copy.centreRegion}>
        {props.centre}
      </section>
      <Show when={props.widths}>{(widths) => <ResizeEdge class="rail-edge" side={widths().rail} onDragging={setResizeDragging} />}</Show>
    </div>
    <Show when={mode() === "overlay" && placement().rendered}>
      <div class="shelf-scrim" onPointerDown={(event) => event.preventDefault()} onClick={() => placement().onClose?.()} />
    </Show>
    <div class="overlay">{props.overlay}</div>
    <section
      {...binding("shelf")}
      ref={(element) => attach("shelf", element)}
      class="shelf"
      aria-label={copy.shelfLabel}
      data-open={placement().shown}
      data-animated={placement().animated}
      hidden={!placement().rendered}
      inert={!placement().open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "transform") { placement().onSettle(); setShelfSliding(false); }
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
          <ResizeEdge class="shelf-edge" side={widths().shelf} onDragging={setResizeDragging} />
        </div>
      )}
    </Show>
  </div>
  );
};
