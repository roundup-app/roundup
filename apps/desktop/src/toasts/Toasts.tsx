import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { ToastProvider } from "../ui/Toast";
import type { ToastQueue } from "./queue";
import "./styles.css";

/** U411, U414: the layer of Toasts at the window's bottom-right. The shared Toast renders and times each card; the polite live region stays mounted and empty while none shows, so a new card changes text inside it. */
export const Toasts = (props: { queue: ToastQueue }) => {
  return (
    <ReservedLine overlay class="toasts" aria-label={copy.toastsRegion} aria-live="polite"
      content={<ToastProvider toast={props.queue.toast} label={copy.toastsRegion} />} />
  );
};
