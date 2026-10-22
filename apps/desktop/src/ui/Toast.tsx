import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { createToaster, Toaster, Toast, type ToastStatusChangeDetails } from "@ark-ui/solid/toast";
import { onCleanup, Show, type JSX } from "solid-js";
import "./Toast.css";

type Card = { id: string; label?: string; name: JSX.Element; content: JSX.Element; glyph?: JSX.Element; duration?: number; /** Replaces the activation button, for a card nothing opens. */ body?: () => JSX.Element; /** Not counted against the limit. */ extra?: boolean };

const DURATION = 5000;

const focusInStack = () => document.querySelector(".app-toasts:focus-within") !== null;

const held = () => document.visibilityState === "hidden" || focusInStack();

/** Caller supplies eligibility, identity and summaries. Ark alone owns card lifetimes. */
export function createToast(policy: {
  limit: number;
  newestFirst: boolean;
  onActivate?: (id: string, source: ActivationSource) => void;
  onDismiss?: (id: string) => void;
}) {
  // Admission happens before create: no hidden Ark overflow can replay old cards.
  const closing = new Set<string>();
  // U3791: Ark's group pauses every timer while the pointer or focus is in the stack and resumes each from the time it had left; its own page-idle option sends an event nothing handles, so ToastProvider pauses on a hidden window. U3792: overlap folds the cards behind the newest one; hover or focus fans them out.
  const store = createToaster({ placement: "bottom-end", max: Infinity, duration: DURATION, removeDelay: 150, pauseOnPageIdle: false, overlap: true, gap: 8, offsets: "0px" });

  // Ark resumes and folds the stack when the pointer leaves, whatever else holds it: focus still in the stack, or a hidden window, keeps the time held and the cards fanned out.
  const { resume, collapse } = store;

  store.resume = (id) => { if (!held()) resume(id); };

  store.collapse = () => { if (!focusInStack()) collapse(); };

  return {
    store,
    newestFirst: policy.newestFirst,
    show(card: Card) {
      if (policy.limit <= 0) return;
      closing.delete(card.id);
      const visible = store.getVisibleToasts();

      if (!visible.some((value) => value.id === card.id)) {
        for (const old of visible.filter((value) => !value.meta?.extra).slice(Math.max(0, policy.limit - 1))) store.remove(old.id);
      }

      store.create({ id: card.id, title: card.name, description: card.content, duration: card.duration ?? DURATION, meta: { glyph: card.glyph, label: card.label, body: card.body, extra: card.extra, duration: card.duration ?? DURATION }, onStatusChange(details: ToastStatusChangeDetails) {
        if (details.status === "dismissing") {
          closing.add(card.id);
          policy.onDismiss?.(card.id);
        }

        if (details.status === "unmounted") closing.delete(card.id);
      } });
    },
    dismiss(id: string) { closing.add(id); store.dismiss(id); },
    activate(id: string, source: ActivationSource = "pointer") {
      if (!store.isVisible(id) || closing.has(id)) return;
      closing.add(id);
      store.dismiss(id);
      policy.onActivate?.(id, source);
    },
  };
}

export function ToastProvider(props: { toast: ReturnType<typeof createToast>; label: string }) {
  const store = props.toast.store;

  // U3791: a hidden window holds every timer; it resumes only when the pointer is out of the stack too.
  const pageIdle = () => {
    if (document.visibilityState === "hidden") store.pause();
    else if (!document.querySelector(".app-toasts:hover")) store.resume();
  };

  document.addEventListener("visibilitychange", pageIdle);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", pageIdle);
    store.remove();
  });

  return <Toaster toaster={store} label={props.label} aria-label={props.label} class="app-toasts" data-newest-first={props.toast.newestFirst}>
    {(card) => {
      return <Toast.Root onFocusIn={(event) => {
        // Ark's group sends focus back to where it came from when it leaves the stack, and tracks "focus is in" only when it has such an element: hand it one that takes focus and does nothing, so Tab moves on.
        Object.defineProperty(event, "relatedTarget", { value: { focus() {} } });
      }} class="app-toast" tabIndex={-1} style={{ "--duration": "initial", "--remove-delay": "var(--duration-toast)" }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.toast.dismiss(card().id!); }
      }}>
        <Toast.Context>{(api) => {
          const attr = (name: string) => Object.entries(api().getRootProps()).find(([key]) => key === name)?.[1];
          // U3792: a card behind the newest, while the stack is folded, takes no focus.
          const folded = () => attr("data-sibling") !== undefined && attr("data-overlap") !== undefined;

          return <>
            <Show when={card().meta?.body} fallback={<button type="button" data-button="quiet" class="app-toast-action" aria-label={card().meta?.label} tabIndex={folded() ? -1 : undefined}
              onClick={(event) => props.toast.activate(card().id!, activationSource(event))}>
              <span class="app-toast-heading">
                <span class="app-toast-glyph" aria-hidden="true">{card().meta?.glyph}</span>
                <Toast.Title asChild={(title) => <span {...title()} />}>{card().title}</Toast.Title>
              </span>{" "}
              <Toast.Description asChild={(description) => <span {...description()} />}>{card().description}</Toast.Description>
            </button>}>{(body) => body()()}</Show>
            {/* U3790: the time left, draining while the card runs; it holds still with the timer. */}
            <span class="app-toast-bar" aria-hidden="true" style={{ "--toast-time": `${card().meta?.duration}ms`, "animation-play-state": api().paused || !api().visible ? "paused" : "running" }} />
          </>;
        }}</Toast.Context>
      </Toast.Root>;
    }}
  </Toaster>;
}
