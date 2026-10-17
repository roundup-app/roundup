import { copy } from "../copy";
import { useSplitter } from "@ark-ui/solid/splitter";
import { createEffect, createSignal, createUniqueId, on, onCleanup, onMount, type JSX } from "solid-js";
import type { Side } from "../resize/widths";
import "./Splitter.css";

/** Binds U507's host from an edge, leaving grid and absolute panel styles with Layout. */
export function Splitter(props: { side: Side; class?: string; disabled?: boolean; hidden?: boolean; onDragging?: (dragging: boolean) => void }) {
  let edge!: HTMLDivElement;
  let pointerResize = false;
  let previewed = false;
  const id = createUniqueId();
  const [host, setHost] = createSignal<HTMLElement>();
  const [extent, setExtent] = createSignal(1);
  const [other, setOther] = createSignal(0);
  const [pixels, setPixels] = createSignal(props.side.now());
  const [step, setStep] = createSignal(16);
  const index = () => props.side.direction === 1 ? 0 : 2;
  const rootId = () => host()?.id ?? id;
  const maximum = () => Math.max(props.side.min, Math.min(props.side.room(), extent() - other()));
  const clamp = (px: number) => Math.max(props.side.min, Math.min(maximum(), px));
  const percent = (px: number) => px / (host()?.getBoundingClientRect().width || extent()) * 100;

  const sizes = () => {
    const rail = index() === 0 ? pixels() : other();
    const shelf = index() === 2 ? pixels() : other();

    return [`${rail}px`, `${Math.max(0, extent() - rail - shelf)}px`, `${shelf}px`];
  };

  const publish = (size: number[], end = false) => {
    const px = clamp(Math.round(size[index()]! * (host()?.getBoundingClientRect().width || extent()) / 100));

    setPixels(px);

    if (end) props.side.commit(px);
    else props.side.preview(px);
  };

  const api = useSplitter({
    id,
    get ids() { return { root: rootId(), panel: (panel: string | number) => `${rootId()}-${panel}` }; },
    get panels() {
      return ["rail", "centre", "shelf"].map((panel, at) => ({
        id: panel,
        resizeBehavior: at === 1 ? "preserve-relative-size" as const : "preserve-pixel-size" as const,
        minSize: at === index() ? `${props.side.min}px` : at === 1 ? 0 : `${other()}px`,
        maxSize: at === index() ? `${maximum()}px` : at === 1 ? 100 : `${other()}px`,
      }));
    },
    get size() { return sizes(); },
    get keyboardResizeBy() { return percent(step()); },
    onResize: ({ size }) => { previewed = true; publish(size); },
    onResizeEnd: ({ size }) => {
      // Ark ends pointer clicks too; committing those would triple a double-click reset.
      if (!pointerResize || previewed) publish(size, true);
      props.onDragging?.(false);
    },
  });

  const triggerId = () => props.side.direction === 1 ? "rail:centre" as const : "centre:shelf" as const;
  const trigger = () => api().getResizeTriggerProps({ id: triggerId(), disabled: props.disabled || props.hidden });

  createEffect(on(() => props.side.now(), (value) => setPixels(value)));

  onMount(() => {
    const root = edge.closest<HTMLElement>("[data-layout-root]");

    if (!root) throw new Error(copy.resizeUnavailable);

    if (!root.id) root.id = id;
    setHost(root);

    // Both edges share stable host/panel identity. Never forward Ark's flex sizing.
    for (const [name, value] of Object.entries(api().getRootProps())) {
      if (name === "id" || name.startsWith("data-")) root.setAttribute(name, String(value));
    }

    for (const panel of root.querySelectorAll<HTMLElement>("[data-layout-panel]")) {
      const name = panel.dataset.layoutPanel!;

      for (const [key, value] of Object.entries(api().getPanelProps({ id: name }))) {
        if (key === "id" || key.startsWith("data-")) panel.setAttribute(key, String(value));
      }
    }

    const measure = () => {
      setExtent(root.getBoundingClientRect().width || 1);
      const opposite = root.querySelector<HTMLElement>(`[data-layout-panel="${index() === 0 ? "shelf" : "rail"}"]`);

      setOther(opposite && !opposite.hidden ? opposite.getBoundingClientRect().width : 0);
    };

    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(root);

    for (const panel of root.querySelectorAll<HTMLElement>("[data-layout-panel]")) observer.observe(panel);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => props.onDragging?.(false));

  const reset = () => {
    if (props.disabled || props.hidden || api().dragging) return;
    const px = clamp(props.side.fallback);
    const next = api().getSizes();

    next[index()] = percent(px);
    next[1] = 100 - next[0]! - next[2]!;
    api().setSizes(next);
    setPixels(px);
    props.side.preview(px);
    props.side.commit(px);
  };

  const pointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (!api().dragging) { pointerResize = true; previewed = false; }

    // The Terminal refits once the hold ends, so the hold is the pointer's, not the machine's moment-to-moment state.
    if (event.button === 0 && !props.disabled && !props.hidden) {
      const release = () => {
        window.removeEventListener("pointerup", release, true);
        window.removeEventListener("pointercancel", release, true);
        props.onDragging?.(false);
      };

      props.onDragging?.(true);
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", release, true);
    }

    const handler = trigger().onPointerDown;

    if (handler) {
      if (0 in handler) handler[0](handler[1], event);
      else handler(event);
    }
  };

  const boundaryKeys = Object.keys({ Home: true, End: true });

  const keyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.defaultPrevented) return;

    if (!api().dragging) pointerResize = false;

    if (event.key === "Enter") { event.preventDefault(); reset();

 return; }

    setStep(event.shiftKey ? 64 : 16);

    // Ark's Shift delta is hard-coded to 10%; normalize the modifier while its
    // own key map, limits, direction and keyboard state still perform the action.
    const key = props.side.direction === -1 && boundaryKeys.includes(event.key)
      ? boundaryKeys.find((value) => value !== event.key) ?? event.key
      : event.key;

    const adapted = new KeyboardEvent("keydown", {
      key,
      shiftKey: /^Arrow(?:Left|Right|Up|Down)$/.test(event.key) ? false : event.shiftKey,
      ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, cancelable: true,
    });

    Object.defineProperties(adapted, { target: { value: event.target }, currentTarget: { value: event.currentTarget } });
    // SAFETY: the normalized event retains the original element targets above.
    const normalized = adapted as KeyboardEvent & { currentTarget: HTMLDivElement; target: Element };
    const handler = trigger().onKeyDown;

    if (handler) {
      if (0 in handler) handler[0](handler[1], normalized);
      else handler(normalized);
    }

    if (adapted.defaultPrevented) event.preventDefault();
  };

  return <div {...trigger()} ref={(element) => { edge = element; }} class={`resize-edge app-splitter ${props.class ?? ""}`} hidden={props.hidden}
    tabIndex={props.disabled || props.hidden ? -1 : 0}
    aria-label={props.side.label} aria-orientation="vertical" aria-valuenow={pixels()} aria-valuemin={props.side.min} aria-valuemax={maximum()}
    onPointerDown={pointerDown} onKeyDown={keyDown} onDblClick={reset} />;
}
