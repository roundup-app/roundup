import { createMaximiseSlide } from "../ui/slideLifetime";
import Maximize from "@lucide/solid/icons/maximize";
import Minimize from "@lucide/solid/icons/minimize";
import X from "@lucide/solid/icons/x";
import { IconButton } from "../ui/IconButton";
import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { triage } from "../todos/triage";
import { copy } from "./copy";
import { makeEventListener } from "@solid-primitives/event-listener";
import { createEffect, createMemo, createSignal, onCleanup, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ResizeEdge } from "../resize/ResizeEdge";
import { setShelfSliding } from "../shelf/sliding";
import { setResizeDragging } from "../resize/dragging";
import type { Widths } from "../resize/widths";
import { railView } from "../rail/slide";
import { RailToggle } from "../rail/RailToggle";

/** U7156: the strip's head holds the Rail's toggle while the Rail is collapsed; the open Rail's WORKSTREAMS header holds it otherwise. */
const StripHead = (props: { toggle: { collapsed: boolean; onToggle: () => void } | undefined }) => (
  <Show when={props.toggle}>{(toggle) => <div class="rail-strip-head"><RailToggle collapsed onToggle={toggle().onToggle} /></div>}</Show>
);

/** How the Shelf sits (U369 to U371): in the layout or not, slid in or out, and whether a change slides. */
export type ShelfPlacement = { open: boolean; peeking?: boolean; covering?: boolean; rendered: boolean; shown: boolean; animated: boolean; keyed?: boolean; maximised?: boolean; onMaximise?: (source: ActivationSource) => void; reducedMotion?: boolean; onClose?: (source?: ActivationSource) => void; onSettle: () => void; attach?: (element: HTMLElement) => void; sliding?: boolean };

const SETTLED: ShelfPlacement = { open: true, rendered: true, shown: true, animated: false, onSettle: () => {} };

/** What the window reports of the Shelf: open, peeking over the centre, or closed. */
const shelfStateOf = (placement: ShelfPlacement) => placement.open ? "open" : placement.peeking ? "peek" : "closed";

/** The focused element when it sits in the Shelf outside the controls that keep their own keys, else null. */
const shelfFocusOf = (focus: Element | null): Element | null =>
  focus?.closest(".shelf") && !focus.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]") ? focus : null;

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
  /** U6228: the Rail's collapsed form; it shows in place of `rail` while `widths.collapsed()` holds, and `rail` stays mounted, hidden. */
  railStrip?: JSX.Element;
  /** U6228: the collapsed Rail is slid out over the centre; it reserves no width. */
  railPeeking?: boolean;
  /** U6228g: how the Rail slides now: a click's drawer motion, a key's, or the reduced-motion fade. */
  railSlide?: "click" | "key" | "fade" | undefined;
  /** U6228h: the Rail's edge handle; absent, none shows. */
  railToggle?: { collapsed: boolean; onToggle: () => void } | undefined;
  railOpen?: boolean;
  centre: JSX.Element;
  shelf: JSX.Element;
  shelfTabs?: JSX.Element;
  shelfPlacement?: ShelfPlacement;
  /** U389, U390: the Rail's and Shelf's widths; without them the Tokens' defaults apply and no Resize edge shows. */
  widths?: Widths;
  overlay: JSX.Element;
  /** Publishes whether the Shelf floats over the centre. */
  onOverlaid?: (overlaid: boolean) => void;
}) => {
  const [shelfFocus, setShelfFocus] = createSignal<Element | null>(null);

  const sync = () => setShelfFocus(shelfFocusOf(document.activeElement));

  makeEventListener(document, "focusin", sync);
  makeEventListener(document, "focusout", sync);

  const placement = () => props.shelfPlacement ?? SETTLED;

  const railMode = () => railView(props.widths, props.railPeeking);

  let windowElement: HTMLDivElement | undefined;
  const [measured, setMeasured] = createSignal<"reserved" | "overlay">("reserved");
  // U6224: a peek covers the centre and reserves nothing, so it lays out as the overlay without its scrim.
  const mode = () => placement().covering ? "overlay" : measured();
  createEffect(createMemo(() => mode() === "overlay"), overlaid => { props.onOverlaid?.(overlaid); });

  const measure = () => {
    if (!windowElement || windowElement.clientWidth === 0) return;
    const style = getComputedStyle(windowElement);
    const available = windowElement.clientWidth - parseFloat(style.getPropertyValue("--rail-width")) - parseFloat(style.getPropertyValue("--shelf-span"));
    setMeasured(available < parseFloat(style.getPropertyValue("--centre-min-width")) ? "overlay" : "reserved");
  };

  // ResizeObserver sees previews as well as committed and restored panel widths.
  onSettled(() => {
    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);

    for (const element of [windowElement, windowElement?.querySelector(".rail"), windowElement?.querySelector(".shelf")]) {
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  });
  createEffect(() => props.widths?.style(), () => { measure(); });
  // Memos: the placement object is rebuilt when any field changes, `sliding` ending included, and that must not start a slide again.
  const shownNow = createMemo(() => placement().shown);
  const coveringNow = createMemo(() => placement().covering);

  createEffect(() => [shownNow(), coveringNow()], () => {
    const drawer = windowElement?.querySelector('.drawer[data-open="true"]');
    setShelfSliding(!drawer && mode() === "reserved" && placement().animated && placement().rendered);
  }, { defer: true });
  createEffect(() => placement().sliding === false, stopped => { if (stopped) setShelfSliding(false); });
  onCleanup(() => placement().onSettle());
  const shelfElement = () => windowElement?.querySelector<HTMLElement>(".shelf") ?? undefined;
  const maximiseSlide = createMaximiseSlide(shelfElement, () => placement().open && !placement().reducedMotion);

  const maximised = createMemo(() => placement().maximised === true);

  // U3721b: the width before the change, read while the old size still draws.
  createEffect(() => {
    maximised();

    return maximiseSlide.visibleWidth();
  }, widthBefore => {
    const shelf = shelfElement();
    maximiseSlide.cancel();

    if (!windowElement || !shelf?.animate || mode() !== "reserved" || !placement().animated || !placement().open) return;
    maximiseSlide.start(widthBefore, placement().keyed === true, () => setShelfSliding(false));
  }, { defer: true });

  // U3721b: the centre takes its final width once, when the slide ends, never by interpolating it.
  const reserved = createMemo<boolean>((prev = false) => placement().sliding === true ? prev && placement().shown : placement().shown);
  createEffect(() => placement().reducedMotion, reduced => { if (reduced) setShelfSliding(false); });
  onCleanup(() => setShelfSliding(false));

  return (
  <div class="window" data-rail={props.railOpen === false ? "closed" : "open"} data-shelf-maximised={String(mode() === "reserved" && placement().maximised === true)} data-layout-root="" ref={(element) => { windowElement = element; props.widths?.attach(element); }} style={props.widths?.style()} data-shelf={shelfStateOf(placement())} data-shelf-peek={String(placement().covering === true)} data-shelf-mode={mode()} data-shelf-shown={String(placement().shown)} data-shelf-reserved={String(reserved())} data-shelf-key={String(placement().keyed === true)} data-shelf-animated={String(placement().animated)}>
    <header class="header">{props.header}</header>
    <div {...props.tabs} style={{ display: "grid", "grid-area": "2 / 1", "min-height": "0", "min-width": "0" }}>
    <div class="columns" style={{ "grid-area": "1 / 1" }}>
      <section class="rail" aria-busy={props.busy ? "true" : undefined} data-collapsed={railMode().strip ? "true" : undefined} data-peek={railMode().peek ? "true" : undefined} data-slide={props.railSlide} data-layout-panel="rail" aria-label={copy.rail}>
        <Show when={railMode().strip}>
          <Show when={!railMode().peek}><StripHead toggle={props.railToggle} /></Show>
          {props.railStrip}
        </Show>
        <div class="rail-body" inert={(props.widths?.collapsed() && !props.railPeeking) || undefined} aria-hidden={props.widths?.collapsed() && !props.railPeeking ? "true" : undefined}>
          {props.rail}
        </div>
      </section>
      <section class="centre" aria-busy={props.busy ? "true" : undefined} data-layout-panel="centre" aria-label={copy.centreRegion}>
        {props.centre}
      </section>
      <Show when={props.widths}>{(widths) => <ResizeEdge class="rail-edge" side={widths().rail} onDragging={setResizeDragging} />}</Show>
    </div>
    <Show when={mode() === "overlay" && placement().rendered && !placement().covering}>
      <div class="shelf-scrim" onPointerDown={(event) => event.preventDefault()} onClick={() => placement().onClose?.()} />
    </Show>
    <div class="overlay">{props.overlay}</div>
    <section
      class="shelf"
      data-layout-panel="shelf"
      aria-label={copy.shelfLabel}
      data-open={String(placement().shown)}
      data-animated={String(placement().animated)}
      hidden={!placement().rendered}
      inert={!placement().open && !placement().peeking}
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
          data-open={String(placement().shown)}
          data-animated={String(placement().animated)}
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
