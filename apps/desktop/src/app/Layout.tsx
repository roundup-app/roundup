import { createMaximiseSlide } from "../ui/slideLifetime";
import Maximize from "lucide-solid/icons/maximize";
import Minimize from "lucide-solid/icons/minimize";
import X from "lucide-solid/icons/x";
import { IconButton } from "../ui/IconButton";
import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { triage } from "../todos/triage";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, splitProps } from "solid-js";
import type { JSX } from "solid-js";
import { ResizeEdge } from "../resize/ResizeEdge";
import { setShelfSliding } from "../shelf/sliding";
import { setResizeDragging } from "../resize/dragging";
import type { Widths } from "../resize/widths";

/** How the Shelf sits (U369 to U371): in the layout or not, slid in or out, and whether a change slides. */
export type ShelfPlacement = { open: boolean; rendered: boolean; shown: boolean; animated: boolean; maximised?: boolean; onMaximise?: (source: ActivationSource) => void; reducedMotion?: boolean; onClose?: (source?: ActivationSource) => void; onSettle: () => void; attach?: (element: HTMLElement) => void; sliding?: boolean };

const SETTLED: ShelfPlacement = { open: true, rendered: true, shown: true, animated: false, onSettle: () => {} };

/** Rail left, centre right; nesting and columns are never drawn as boxes. The Shelf reserves the centre when it has room; the overlay floats over both; every region starts below the window bar. */
export const Layout = (props: {
  header: JSX.Element;
  /** U495 / #1997: bind the common Tabs context's getContentProps({ value: activePath })
   * here. The panel contains the real Project regions, never the header triggers.
   * Only the selected Project is rendered; connections and saved state stay in App.
   * header/ consumes that context's List and Trigger without creating another Root.
   */
  tabs?: JSX.HTMLAttributes<HTMLDivElement>;
  busy?: boolean;
  rail: JSX.Element;
  railOpen?: boolean;
  centre: JSX.Element;
  shelf: JSX.Element;
  shelfTabs?: JSX.Element;
  shelfPlacement?: ShelfPlacement;
  /** U389, U390: the Rail's and Shelf's widths; without them the Tokens' defaults apply and no Resize edge shows. */
  widths?: Widths;
  overlay: JSX.Element;
  /** U491 / #2003: an existing edge can find its host with
   * closest('[data-layout-root]') and its panels with [data-layout-panel].
   * These markers also exist without splitter props, so a shared adapter needs
   * no App caller change or App class selector to bind the current Layout.
   * For declarative binding, spread useSplitter().getRootProps() on root and getPanelProps()
   * on rail/centre/shelf. All three owned panels are descendants of the measured
   * window root, including the absolute Shelf. Do not use an edge as the root.
   * Layout discards library flex styles, refs, classes and children: CSS grid,
   * Shelf placement and widths.style() retain geometry ownership. Map controlled
   * pixel widths to percentages of root.getBoundingClientRect().width in the
   * shared ui/ adapter; it also handles the hidden/overlay Shelf allocation.
   * Bind triggers through the existing ResizeEdge callers in #2003, never add
   * another drag/key machine here. IDs let Ark resolve hosts without selectors
   * for App classes; ownership attributes let it discover the real panels.
   */
  splitter?: Partial<Record<"root" | "rail" | "centre" | "shelf", JSX.HTMLAttributes<HTMLElement>>>;
}) => {
  const binding = (part: "root" | "rail" | "centre" | "shelf") =>
    splitProps(props.splitter?.[part] ?? {}, ["style", "ref", "class", "classList", "children"])[1];

  const [shelfFocus, setShelfFocus] = createSignal<Element | null>(null);

  onMount(() => {
    const sync = () => {
      const focus = document.activeElement;

      setShelfFocus(focus?.closest(".shelf") && !focus.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]") ? focus : null);
    };

    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    onCleanup(() => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
    });
  });

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
  createEffect(() => { if (placement().sliding === false) setShelfSliding(false); });
  onCleanup(() => placement().onSettle());
  const maximiseSlide = createMaximiseSlide(() => windowElement?.querySelector<HTMLElement>(".shelf") ?? undefined, () => placement().open && !placement().reducedMotion);

  const maximised = createMemo(() => placement().maximised === true);

  createEffect(on(maximised, (expanded) => {
    const shelf = windowElement?.querySelector<HTMLElement>(".shelf");
    const offset = maximiseSlide.offset();
    maximiseSlide.cancel();

    if (!windowElement || !shelf?.animate || mode() !== "reserved" || !placement().animated || !placement().open) return;
    const style = getComputedStyle(windowElement);
    const displacement = windowElement.clientWidth - (windowElement.querySelector(".rail")?.getBoundingClientRect().width ?? 0) - parseFloat(style.getPropertyValue("--shelf-span"));
    maximiseSlide.start(offset + (expanded ? displacement : -displacement), () => setShelfSliding(false));
  }, { defer: true }));
  createEffect(() => { if (placement().reducedMotion) setShelfSliding(false); });
  onCleanup(() => setShelfSliding(false));

  return (
  <div {...binding("root")} class="window" data-rail={props.railOpen === false ? "closed" : "open"} data-shelf-maximised={mode() === "reserved" && placement().maximised === true} data-layout-root="" ref={(element) => { windowElement = element; props.widths?.attach(element); }} style={props.widths?.style()} data-shelf={placement().open ? "open" : "closed"} data-shelf-mode={mode()} data-shelf-shown={placement().shown} data-shelf-animated={placement().animated}>
    <header class="header">{props.header}</header>
    <div {...props.tabs} style={{ display: "grid", "grid-area": "2 / 1", "min-height": "0", "min-width": "0" }}>
    <div class="columns" style={{ "grid-area": "1 / 1" }}>
      <section {...binding("rail")} class="rail" aria-busy={props.busy || undefined} data-layout-panel="rail" aria-label={copy.rail}>
        {props.rail}
      </section>
      <section {...binding("centre")} class="centre" aria-busy={props.busy || undefined} data-layout-panel="centre" aria-label={copy.centreRegion}>
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
      class="shelf"
      data-layout-panel="shelf"
      aria-label={copy.shelfLabel}
      data-open={placement().shown}
      data-animated={placement().animated}
      hidden={!placement().rendered}
      inert={!placement().open}
      ref={element => placement().attach?.(element)}
    >
      {props.shelfTabs}
      <div class="shelf-controls">
        <Show when={mode() === "reserved" && placement().onMaximise}>
          <IconButton aria-label={placement().maximised ? copy.restore : copy.maximise} action={shelfFocus() ? "shelf.maximise" : undefined} onClick={event => placement().onMaximise?.(activationSource(event))}>
            <Show when={placement().maximised} fallback={<Maximize class="icon" aria-hidden="true" />}><Minimize class="icon" aria-hidden="true" /></Show>
          </IconButton>
        </Show>
        <Show when={placement().onClose}>
          <IconButton aria-label={copy.closeShelf} tooltip={copy.close} action={shelfFocus()?.closest(".shelf-controls") && !triage.on() ? "shelf.close" : undefined} onClick={event => placement().onClose?.(activationSource(event))}><X class="icon" aria-hidden="true" /></IconButton>
        </Show>
      </div>
      {props.shelf}
    </section>
    <Show when={props.widths}>
      {(widths) => (
        <div
          class="shelf-edge-slot"
          data-open={placement().shown}
          data-animated={placement().animated}
          hidden={!placement().rendered || (mode() === "reserved" && placement().maximised === true)}
          inert={!placement().open}
        >
          <ResizeEdge class="shelf-edge" side={widths().shelf} onDragging={setResizeDragging} />
        </div>
      )}
    </Show>
    </div>
  </div>
  );
};
