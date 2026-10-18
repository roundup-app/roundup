import { createEffect, createMemo, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type { App } from "../app/seam";
import type { RailState } from "../state/rail";
import { resolvedWorkstream } from "../rail/layout";
import { Tip } from "../ui/Tip";
import { copy } from "../copy";
import { middleCut } from "./middleCut";

/** U449–U451: the Project strip and selected Workstream share the native window bar. */
export const WindowBar = (props: {
  app: Pick<App, "setWindowTitle" | "dragWindow" | "zoomWindow">;
  project: string | undefined;
  rail: RailState | undefined;
  children: JSX.Element;
  onFailure: (message: string | null) => void;
}) => {
  const title = createMemo(() => {
    if (!props.project) return copy.roundup;

    const nodes = props.rail?.nodes ?? [];
    const id = resolvedWorkstream(nodes, props.rail?.selected() ?? null);
    const row = nodes.find((node) => node.id === id);

    if (row) return `${props.project} — ${row.name}`;

    return props.project;
  });

  let writing = false;
  let written: string | undefined;
  let disposed = false;

  onCleanup(() => { disposed = true; });

  // Serialize native writes: an older pending setter must finish before the newest title reaches the window.
  const write = async () => {
    if (writing || disposed) return;
    writing = true;

    while (!disposed && written !== title()) {
      const next = title();
      written = next;

      try {
        await props.app.setWindowTitle(next);

        if (!disposed) props.onFailure(null);
      } catch (error) {
        if (!(error instanceof Error)) throw error;

        if (!disposed) props.onFailure(error.message);
      }
    }

    writing = false;
  };

  createEffect(() => { title(); void write(); });

  // U2228b: the visible title is cut in the middle to the box; the accessible name and `title` stay whole.
  let box: HTMLDivElement | undefined;
  const fit = () => { if (box) middleCut(box, title()); };

  createEffect(() => { title(); fit(); });

  createEffect(() => {
    if (!box?.parentElement || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(fit);
    observer.observe(box.parentElement);
    onCleanup(() => observer.disconnect());
  });

  const empty = (target: EventTarget | null) => target instanceof Element && !target.closest('button, input, [role="tab"], [role="tablist"], [role="dialog"], [role="alertdialog"], [role="menu"], .tab-tip, .traffic-lights');

  const action = async (kind: "drag" | "zoom") => {
    try {
      await (kind === "drag" ? props.app.dragWindow() : props.app.zoomWindow());
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (!disposed) props.onFailure(error.message);
    }
  };

  return (
    <div class="window-bar" data-flat-bar="" onMouseDown={(event) => {
      if (event.button === 0 && empty(event.target)) void action(event.detail === 2 ? "zoom" : "drag");
    }}>
      <div class="traffic-lights" aria-hidden="true" />
      {props.children}
      <Tip text={title()}>
        {(trigger) => <div {...trigger({})} class="window-title" role="heading" aria-level="1" tabIndex={0} aria-label={title()} ref={box} />}
      </Tip>
    </div>
  );
};
