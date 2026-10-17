import { createToaster, Toaster, Toast, type ToastStatusChangeDetails } from "@ark-ui/solid/toast";
import { onCleanup, type JSX } from "solid-js";
import "./Toast.css";

type Card = { id: string; label?: string; name: JSX.Element; content: JSX.Element; glyph?: JSX.Element; duration?: number };

/** Caller supplies eligibility, identity and summaries. Ark alone owns card lifetimes. */
export function createToast(policy: {
  limit: number;
  newestFirst: boolean;
  onActivate?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  // Admission happens before create: no hidden Ark overflow can replay old cards.
  const closing = new Set<string>();
  const store = createToaster({ placement: "bottom-end", max: Infinity, duration: 5000, removeDelay: 150, pauseOnPageIdle: false, gap: 0, offsets: "0px" });

  return {
    store,
    newestFirst: policy.newestFirst,
    show(card: Card) {
      if (policy.limit <= 0) return;
      closing.delete(card.id);
      const visible = store.getVisibleToasts();

      if (!visible.some((value) => value.id === card.id)) {
        for (const old of visible.slice(Math.max(0, policy.limit - 1))) store.remove(old.id);
      }

      store.create({ id: card.id, title: card.name, description: card.content, duration: card.duration ?? 5000, meta: { glyph: card.glyph, label: card.label, duration: card.duration ?? 5000 }, onStatusChange(details: ToastStatusChangeDetails) {
        if (details.status === "dismissing") {
          closing.add(card.id);
          policy.onDismiss?.(card.id);
        }

        if (details.status === "unmounted") closing.delete(card.id);
      } });
    },
    dismiss(id: string) { closing.add(id); store.dismiss(id); },
    hold(id: string, keeping: boolean) {
      if (closing.has(id)) return;
      const card = store.getVisibleToasts().find((value) => value.id === id);

      if (card) store.update(id, { duration: keeping ? Infinity : card.meta?.duration ?? 5000 });
    },
    activate(id: string) {
      if (!store.isVisible(id) || closing.has(id)) return;
      closing.add(id);
      store.dismiss(id);
      policy.onActivate?.(id);
    },
  };
}

export function ToastProvider(props: { toast: ReturnType<typeof createToast>; label: string }) {
  const store = props.toast.store;

  onCleanup(() => store.remove());

  return <Toaster toaster={store} label={props.label} aria-label={props.label} class="app-toasts" data-newest-first={props.toast.newestFirst}>
    {(card) => {
      let hovered = false;
      let focused = false;
      const pause = () => props.toast.hold(card().id!, true);
      const restart = () => { if (!hovered && !focused) props.toast.hold(card().id!, false); };

      // Keep ordinary Tab navigation out of Ark’s restore-to-previous-focus path.
      return <Toast.Root onFocusIn={(event) => event.stopPropagation()} class="app-toast" tabIndex={-1} style={{ "--duration": "initial", "--remove-delay": "var(--duration-toast)" }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.toast.dismiss(card().id!); }
      }}>
        <button type="button" data-button="quiet" class="app-toast-action" aria-label={card().meta?.label}
          onClick={() => props.toast.activate(card().id!)}
          onPointerEnter={() => { hovered = true; pause(); }}
          onPointerLeave={() => { hovered = false; restart(); }}
          onFocusIn={() => { focused = true; pause(); }}
          onFocusOut={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            focused = false; restart();
          }}>
          <span class="app-toast-heading">
            <span class="app-toast-glyph" aria-hidden="true">{card().meta?.glyph}</span>
            <Toast.Title asChild={(title) => <span {...title()} />}>{card().title}</Toast.Title>
          </span>{" "}
          <Toast.Description asChild={(description) => <span {...description()} />}>{card().description}</Toast.Description>
        </button>
      </Toast.Root>;
    }}
  </Toaster>;
}
