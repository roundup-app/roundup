import { makeEventListenerStack } from "@solid-primitives/event-listener";
import { makeResizeObserver } from "@solid-primitives/resize-observer";
import { ReservedLine } from "../ink/ReservedLine";
import { createEffect, For, on, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { registerKeys } from "../keys/registry";
import { Panel } from "../ui/Panel";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ink/Icon";
import { copy } from "./copy";
import type { Screens } from "../terminal/screens";
import { clamped, resizedAbout, STEP, toggledFill, ZONES } from "./places";
import type { Place, Extent, Zone } from "./places";

const ESCAPE = "Escape".split(" ");

/** U2236 call 2: `--space-2` strips centred on the edges, `--space-4` squares over the corners. */
const EDGE = 8;

const CORNER = 16;

const zoneBox = (place: Place, zone: Zone) => {
  const thick = zone.sx !== 0 && zone.sy !== 0 ? CORNER : EDGE;

  const along = (low: number, size: number, sign: number, span: number): [number, number] =>
    sign < 0 ? [low - span / 2, span] : sign > 0 ? [low + size - span / 2, span] : [low + CORNER / 2, size - CORNER];

  const [left, width] = along(place.x, place.w, zone.sx, thick);
  const [top, height] = along(place.y, place.h, zone.sy, thick);

  return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` };
};

const SHIFT = "Shift+".split(" ")[0]!;

const ARROWS = new Map<string, [number, number]>(Object.entries({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }));

export const Bubble = (props: {
  id: string;
  preparing?: boolean;
  hostRef?: (host: HTMLElement, settled: () => boolean) => void;
  screens: Screens;
  name: string;
  place: Place;
  origin: { left: number; top: number };
  extent(): Extent;
  setPlace(id: string, place: Place): void;
  readOnly(): boolean;
  close(id: string): Promise<void>;
  menu(event: MouseEvent): void;
  toggleMinimised(id: string): void;
}) => {
  const id = () => props.id;
  let body: HTMLDivElement | undefined;
  let frame: number | null = null;

  const place = () => props.place;

  const refit = () => {
    frame = null;

    if (body && !props.preparing && !place().min && !props.readOnly()) props.screens.resize(id(), props.screens.emulatorFor(id()).fit(), true);
  };

  const refitNextFrame = () => {
    frame ??= requestAnimationFrame(refit);
  };

  onCleanup(() => {
    if (frame !== null) cancelAnimationFrame(frame);

    props.screens.viewing(id(), false);
    props.screens.hide(id());
  });

  // A Terminal is viewed while its Bubble is open; a folded or closed one gathers unseen output.
  createEffect(() => { if (!props.preparing) props.screens.viewing(id(), !place().min); });

  const mount = (host: HTMLDivElement) => {
    body = host;

    props.hostRef?.(host, () => restoreResize === undefined);
    createEffect(on(() => props.preparing ? null : id(), terminal => {
      if (terminal !== null) props.screens.resize(terminal, props.screens.show(terminal, host, false));
    }));

    if (typeof ResizeObserver !== "undefined") {
      const watched = makeResizeObserver(refitNextFrame);

      watched.observe(host);
    }
  };

  // A bubble that was folded is fitted again when it comes back.
  createEffect(on(() => place().min, (folded) => { if (!folded) refitNextFrame(); }, { defer: true }));

  const [listen, clearListeners] = makeEventListenerStack(window);

  let restoreResize: (() => void) | undefined;

  registerKeys({ kind: "app" }, [{ chords: ESCAPE, when: () => props.preparing || restoreResize !== undefined, run: () => { if (props.preparing) void props.close(id()); else restoreResize?.(); } }]);
  onCleanup(() => restoreResize?.());

  // Move and resize share settlement; listeners exist before capture can cause an early blur.
  const drag = (start: PointerEvent, change: (from: Place, dx: number, dy: number) => Place, framed = false) => {
    if (start.button !== 0 || restoreResize) return;

    start.preventDefault();
    start.stopPropagation();

    const from = place();
    const target = start.currentTarget;
    let pointer = { x: start.clientX, y: start.clientY };
    let pending: number | null = null;
    let settled = false;

    const apply = () => {
      pending = null;
      props.setPlace(id(), change(from, pointer.x - start.clientX, pointer.y - start.clientY));
    };

    const move = (event: PointerEvent) => {
      if (event.pointerId !== undefined && event.pointerId !== start.pointerId) return;
      pointer = { x: event.clientX, y: event.clientY };

      if (framed) pending ??= requestAnimationFrame(apply);
      else apply();
    };

    const finish = (restore: boolean) => {
      if (settled) return;
      settled = true;
      clearListeners();
      restoreResize = undefined;

      if (pending !== null) cancelAnimationFrame(pending);

      if (restore) props.setPlace(id(), from);
      else if (pending !== null) apply();
      pending = null;

      if (target instanceof Element && target.hasPointerCapture?.(start.pointerId)) target.releasePointerCapture(start.pointerId);
    };

    const cancel = () => finish(true);
    const up = (event: PointerEvent) => { if (event.pointerId === undefined || event.pointerId === start.pointerId) finish(false); };

    const cancelled = (event: PointerEvent) => { if (event.pointerId === undefined || event.pointerId === start.pointerId) cancel(); };

    const focus = (event: FocusEvent) => { if (event.target !== target) cancel(); };

    listen("pointermove", move);
    listen("pointerup", up);
    listen("pointercancel", cancelled);
    listen("blur", event => { if (event.target === event.currentTarget) cancel(); }, { capture: true });
    listen("focusin", focus);
    restoreResize = cancel;

    try {
      if (!settled && target instanceof Element) target.setPointerCapture?.(start.pointerId);
    } catch {
      // Window listeners still follow a pointer when capture is unavailable.
    }
  };

  /** U2236: centre resize writes once per frame and cancellation restores its original place. */
  const resize = (start: PointerEvent, zone: Zone) => drag(start,
    (from, dx, dy) => resizedAbout(from, zone, dx, dy, props.extent()), true);

  let header: HTMLElement | undefined;

  // Arrows on the focused header move the bubble, Shift arrows resize it; the registry matches the exact modifiers.
  registerKeys({ kind: "region", element: () => header }, [{
    chords: [...ARROWS.keys(), ...[...ARROWS.keys()].map((key) => `${SHIFT}${key}`)],
    when: (press) => press.target === header,
    run: (press) => {
      const arrow = ARROWS.get(press.key)!;
      const from = place();

      props.setPlace(id(), clamped(press.shiftKey ? { ...from, w: from.w + arrow[0] * STEP, h: from.h + arrow[1] * STEP } : { ...from, x: from.x + arrow[0] * STEP, y: from.y + arrow[1] * STEP }, props.extent()));
    },
  }]);

  let panel: HTMLElement | undefined;

  // The browser top layer orders by the last `showPopover`, so a restored bubble is the topmost layer and no z-index ranks it (U2307b).
  createEffect(() => {
    const open = !place().min;

    if (!panel?.showPopover) return;

    if (open && !panel.matches(":popover-open")) panel.showPopover();
    else if (!open && panel.matches(":popover-open")) panel.hidePopover();
  });

  /** U2307a: a primary press outside the bubble minimises it; its own tab or chip toggles it, and the press still reaches its target. */
  const dismissed = (event: { detail: { originalEvent: Event } }): void => {
    const press = event.detail.originalEvent;
    const target = press.target;

    if (!(press instanceof PointerEvent) || press.button !== 0 || (target instanceof Element && target.closest(".terminal-tab-pair, .terminal-recover"))) return;

    if (props.preparing) props.toggleMinimised(id());
    else if (!place().min) props.setPlace(id(), { ...place(), min: true });
  };

  return (
    <Panel.Root open={!place().min} onPointerDownOutside={dismissed}
      persistentElements={[() => document.querySelector(".hint-line")]} >
      <Portal>
        <Panel.Content ref={(element: HTMLElement) => (panel = element)} class="bubble-frame" role="presentation" popover="manual"
          style={{ display: place().min ? "none" : "block", left: `${props.origin.left}px`, top: `${props.origin.top}px` }}>
          <section class="bubble" data-bubble={id()} role="group" aria-label={props.name || copy.newTerminal} hidden={place().min}
            style={{ left: `${place().x}px`, top: `${place().y}px`, width: `${place().w}px`, height: `${place().h}px` }}>
            <header class="bubble-header" tabindex="0" ref={header} onContextMenu={props.menu} onPointerDown={(event) => {
                // SAFETY: a pointer event on the header always targets an Element.
                if (!(event.target as Element).closest("button")) drag(event, (from, dx, dy) => clamped({ ...from, x: from.x + dx, y: from.y + dy }, props.extent()));
              }} onDblClick={(event) => {
                // SAFETY: a mouse event on the header always targets an Element.
                if (!(event.target as Element).closest("button")) props.setPlace(id(), toggledFill(place(), props.extent()));
              }}>
              <span class="bubble-controls">
                <IconButton data-feedback="ink" aria-label={copy.close} onClick={() => void props.close(id())}><span class="bubble-dot"><Icon name="x" /></span></IconButton>
                <IconButton data-feedback="ink" aria-label={copy.minimise} onClick={() => props.toggleMinimised(id())}><span class="bubble-dot"><Icon name="minus" /></span></IconButton>
              </span>
              <span class="bubble-name">{props.name}</span>
            </header>
            <div class="bubble-body" tabindex="-1" ref={mount} /><ReservedLine overlay class={props.screens.failure(id()) ? "bubble-failure" : undefined} message={props.screens.failure(id())} />
          </section>
          <For each={ZONES}>{(zone) => (
            <span class="bubble-zone" data-zone={zone.name} data-zone-of={id()} aria-hidden="true" hidden={place().min}
              style={{ cursor: zone.cursor, ...zoneBox(place(), zone) }} onPointerDown={(event) => resize(event, zone)} />
          )}</For>
        </Panel.Content>
      </Portal>
    </Panel.Root>
  );
};

