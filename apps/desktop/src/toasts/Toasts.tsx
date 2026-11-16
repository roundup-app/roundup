import { copy } from "./copy";
import { ToastProvider } from "../ui/Toast";
import { createPageVisible } from "../window/focus";
import type { ToastQueue } from "./queue";
import "./styles.css";

/** U411, U414: the layer of Toasts at the window's top right (U7192). The shared Toast renders, times and announces each card; the library's own region is the only live region, so a wrapper never announces a card twice. */
export const Toasts = (props: { queue: ToastQueue }) => {
  const visible = createPageVisible();

  return <div class="toasts"><ToastProvider toast={props.queue.toast} label={copy.toastsRegion} pageHidden={!visible()} /></div>;
};
