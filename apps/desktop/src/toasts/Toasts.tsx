import { copy } from "../copy";
import { createEffect, createSignal, Show } from "solid-js";
import { ErrorLine } from "../ink/ErrorLine";
import { ToastProvider } from "../ui/Toast";
import type { ToastQueue } from "./queue";
import "./styles.css";

/** U411, U414: the layer of Toasts at the window's bottom-right. The shared Toast renders and times each card; the polite live region stays mounted and empty while none shows, so a new card changes text inside it. */
export const Toasts = (props: { queue: ToastQueue }) => {
  const [layer, setLayer] = createSignal<HTMLElement>();

  // U414: the stack rests above the resource strip, so it never covers the Terminal's last line; measured when the Toasts change, never on a loop.
  createEffect(() => {
    props.queue.shown();
    props.queue.failure();

    const element = layer();
    const strip = document.querySelector(".resource-strip");
    const overlay = element?.parentElement;

    if (!element || !overlay) return;

    const top = strip?.getBoundingClientRect().top;
    const room = top === undefined ? 0 : overlay.getBoundingClientRect().bottom - top;

    element.style.setProperty("--toast-lift", room > 0 ? `${Math.ceil(room)}px` : "0px");
    // The failure line rests above whatever cards still show.
    element.style.setProperty("--toast-stack", `${Math.ceil(overlay.querySelector(".app-toasts")?.getBoundingClientRect().height ?? 0)}px`);
  });

  return (
    <div class="toasts" role="status" aria-live="polite" ref={setLayer}>
      <Show when={props.queue.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <ToastProvider toast={props.queue.toast} label={copy.toastsRegion} />
    </div>
  );
};
