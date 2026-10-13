import { createEffect, createSignal, For, Show } from "solid-js";
import { ErrorLine } from "../ink/ErrorLine";
import { KindGlyph } from "../ink/KindGlyph";
import type { ToastQueue, ToastView } from "./queue";
import "./styles.css";

/** U411, U414: the layer of Toasts at the window's bottom-right. It holds an empty polite live region and nothing else while no Toast shows. */
export const Toasts = (props: { queue: ToastQueue }) => {
  const [layer, setLayer] = createSignal<HTMLElement>();
  // Hover and focus each keep a Toast; it restarts its full time when both have ended.
  const keeping = new Map<number, Set<"hover" | "focus">>();

  const keep = (id: number, reason: "hover" | "focus", on: boolean) => {
    const reasons = keeping.get(id) ?? new Set<"hover" | "focus">();

    if (on) reasons.add(reason);
    else reasons.delete(reason);

    keeping.set(id, reasons);
    props.queue.hold(id, reasons.size > 0);
  };

  // U414: the stack rests above the Thread's input, so it never covers what the user types in; measured when the Toasts change, never on a loop.
  createEffect(() => {
    props.queue.views();

    const element = layer();
    const composer = document.querySelector(".thread-composer");
    const overlay = element?.parentElement;

    if (!element || !overlay) return;

    const top = composer?.getBoundingClientRect().top;
    const room = top === undefined ? 0 : overlay.getBoundingClientRect().bottom - top;

    element.style.setProperty("--toast-lift", room > 0 ? `${Math.ceil(room)}px` : "0px");
  });

  const toast = (view: Extract<ToastView, { more: false }>) => (
    <button
      type="button"
      class="toast"
      data-leaving={view.leaving}
      aria-label={`${view.name} ${view.line}`}
      onClick={() => void props.queue.activate(view.id)}
      onPointerEnter={() => keep(view.id, "hover", true)}
      onPointerLeave={() => keep(view.id, "hover", false)}
      onFocusIn={() => keep(view.id, "focus", true)}
      onFocusOut={() => keep(view.id, "focus", false)}
      onKeyDown={(key) => {
        if (key.key === "Escape") props.queue.dismiss(view.id);
      }}
    >
      <KindGlyph kind={view.kind} decorative />
      <span class="toast-name">{view.name}</span>
      <span class="toast-line">{view.line}</span>
    </button>
  );

  return (
    <div class="toasts" ref={setLayer} role="status" aria-live="polite">
      <Show when={props.queue.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <For each={props.queue.views()}>
        {(view) => (view.more ? <p class="toast toast-more">{`and ${view.count} more`}</p> : toast(view))}
      </For>
    </div>
  );
};
