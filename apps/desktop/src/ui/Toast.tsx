import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { createToaster, Toast, ToastDescription, ToastRegion, ToastTitle } from "@ui-sdk/solid/toast";
import { onCleanup, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import "./Toast.css";

type Card = { id: string; label?: string; name: JSX.Element; content: JSX.Element; glyph?: JSX.Element; duration?: number; /** Replaces the activation button, for a card nothing opens. */ body?: () => JSX.Element; /** Not counted against the limit. */ extra?: boolean; /** The card's data-type, for the CSS that keys on it. */ type?: "error" | undefined };

type Meta = { glyph: Card["glyph"]; label: Card["label"]; body: Card["body"]; extra: Card["extra"]; duration: number; /** The card is on its way out; admission and activation no longer count it. */ closing: boolean; /** The queue took the card down itself and needs no word of it. */ silent: boolean };

const DURATION = 5000;

// SAFETY: every toast of a createToast store is created by `show` below, which sets `data` to a Meta.
const metaOf = (toast: { data?: unknown }) => toast.data as Meta;

/** Caller supplies eligibility, identity and summaries. The library alone owns card lifetimes. */
export function createToast(policy: {
  limit: number;
  newestFirst: boolean;
  onActivate?: (id: string, source: ActivationSource) => void;
  onDismiss?: (id: string) => void;
}) {
  // The library holds every timer while the pointer or focus is in the stack or the window is hidden or inactive, and folds and fans the stack itself. Admission happens before create, so no overflow can replay old cards.
  const store = createToaster<JSX.Element>({ duration: DURATION });
  // A dismissed card stays listed until its dismissal callback returns.
  const live = () => store.toasts().filter((toast) => !metaOf(toast).closing);

  /** Takes the card, or every card, down without telling `onDismiss`. */
  const remove = (id?: string) => {
    for (const toast of store.toasts()) if (id === undefined || toast.id === id) metaOf(toast).silent = true;

    store.dismiss(id);
  };

  return {
    store,
    newestFirst: policy.newestFirst,
    show(card: Card) {
      if (policy.limit <= 0) return;
      const visible = live();

      if (!visible.some((value) => value.id === card.id)) {
        for (const old of visible.filter((value) => !metaOf(value).extra).slice(Math.max(0, policy.limit - 1))) remove(old.id);
      }

      const duration = card.duration ?? DURATION;
      const data: Meta = { glyph: card.glyph, label: card.label, body: card.body, extra: card.extra, duration, closing: false, silent: false };

      store({ id: card.id, type: card.type ?? "info", title: card.name, description: card.content, duration, data, onDismiss() {
        data.closing = true;

        if (!data.silent) policy.onDismiss?.(card.id);
      } });
    },
    remove,
    dismiss(id: string) { store.dismiss(id); },
    activate(id: string, source: ActivationSource = "pointer") {
      if (!live().some((value) => value.id === id)) return;
      store.dismiss(id);
      policy.onActivate?.(id, source);
    },
  };
}

export function ToastProvider(props: { toast: ReturnType<typeof createToast>; label: string }) {
  onCleanup(() => props.toast.remove());

  return <ToastRegion toaster={props.toast.store} aria-label={props.label} class="app-toasts" maxVisible={Infinity} data-newest-first={props.toast.newestFirst}>
    {(card) => {
      const meta = metaOf(card);

      return <Toast class="app-toast" render={(attrs) => <li {...attrs} tabindex="-1" />} onKeyDown={(event) => {
        // The library dismisses the card; nothing behind it may also act on the key.
        if (event.key === "Escape") event.stopPropagation();
      }}>
        {(state) => <div class="app-toast-clip">
          <Show when={meta.body} fallback={<button type="button" data-button="quiet" class="app-toast-action" aria-label={meta.label}
            // U3792: a card behind the newest, while the stack is folded, takes no focus.
            tabindex={!state.expanded && state.index > 0 ? -1 : undefined}
            onClick={(event) => props.toast.activate(card.id, activationSource(event))}>
            <span class="app-toast-heading">
              <span class="app-toast-glyph" aria-hidden="true">{meta.glyph}</span>
              <ToastTitle render={(attrs) => <span {...attrs} />}>{card.title}</ToastTitle>
            </span>{" "}
            <ToastDescription render={(attrs) => <span {...attrs} />}>{card.description}</ToastDescription>
          </button>}>{(body) => <div class="app-toast-body">{body()()}</div>}</Show>
          {/* U3790: the time left, draining while the card runs; it holds still with the timer. */}
          <span class="app-toast-bar" aria-hidden="true" style={{ "--toast-time": `${meta.duration}ms`, "animation-play-state": state.expanded ? "paused" : "running" }} />
        </div>}
      </Toast>;
    }}
  </ToastRegion>;
}
