import Hourglass from "lucide-solid/icons/hourglass";
import { createResource, ErrorBoundary, Show, Suspense, type JSX } from "solid-js";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";

/** Solid owns pending/error state; Vite owns the dynamic import and its CSS. */
export const Deferred = <T,>(props: { load: () => Promise<T>; label: string; onClose?: () => void; children: (value: T) => JSX.Element }) => {
  const [loaded, { refetch }] = createResource(props.load);

  return <ErrorBoundary fallback={(error, reset) => <ReservedLine message={error instanceof Error ? error.message : String(error)}>
    <button data-button="quiet" type="button" onClick={() => { void refetch(); reset(); }}>{copy.retry}</button>
    <Show when={props.onClose}><button data-button="quiet" type="button" onClick={() => props.onClose?.()}>{copy.close}</button></Show>
  </ReservedLine>}>
    <Suspense fallback={<span role="status" aria-label={props.label} aria-busy="true"><Hourglass class="icon" aria-hidden="true" /><Show when={props.onClose}><button data-button="quiet" type="button" onClick={() => props.onClose?.()}>{copy.close}</button></Show></span>}>
      <Show when={loaded()}>{value => props.children(value())}</Show>
    </Suspense>
  </ErrorBoundary>;
};
