import Hourglass from "lucide-solid/icons/hourglass";
import { createResource, ErrorBoundary, Show, Suspense, type JSX } from "solid-js";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { SettingsGroup, SettingsShell } from "../settings/SettingsShell";

/** Solid owns pending/error state; Vite owns the dynamic import and its CSS. */
export const Deferred = <T,>(props: { load: () => Promise<T>; label: string; onClose?: () => void; children: (value: T) => JSX.Element }) => {
  const [loaded, { refetch }] = createResource(props.load);

  const fallback = (content: JSX.Element) => props.onClose
    ? <SettingsShell heading={props.label} onClose={props.onClose}><SettingsGroup hideHeading name={props.label}>{content}</SettingsGroup></SettingsShell>
    : content;

  return <ErrorBoundary fallback={(_error, reset) => fallback(<ReservedLine message={copy.surfaceLoadFailed(props.label)}>
    <button data-button="quiet" type="button" onClick={() => { void refetch(); reset(); }}>{copy.retry}</button>
  </ReservedLine>)}>
    <Suspense fallback={<ReservedLine status={copy.surfaceLoading(props.label)} content={<><Hourglass class="icon" aria-hidden="true" />{copy.surfaceLoading(props.label)}</>} aria-busy="true"><Show when={props.onClose}><button data-button="quiet" type="button" onClick={() => props.onClose?.()}>{copy.close}</button></Show></ReservedLine>}>
      <Show when={loaded()}>{value => props.children(value())}</Show>
    </Suspense>
  </ErrorBoundary>;
};
