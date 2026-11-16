import Hourglass from "@lucide/solid/icons/hourglass";
import { affects, createMemo, Errored, isPending, Loading, refresh, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { SettingsGroup, SettingsShell } from "../settings/SettingsShell";

/** Solid owns pending/error state; Vite owns the dynamic import and its CSS. A retry keeps the failure line until the load settles, so the line says it is loading meanwhile. */
export const Deferred = <T,>(props: { load: () => Promise<T>; label: string; onClose?: () => void; children: (value: T) => JSX.Element }) => {
  const loaded = createMemo(() => props.load());

  const fallback = (content: JSX.Element) => props.onClose
    ? <SettingsShell heading={props.label} onClose={props.onClose}><SettingsGroup hideHeading name={props.label}>{content}</SettingsGroup></SettingsShell>
    : content;

  const loading = () => <ReservedLine status={copy.surfaceLoading(props.label)} content={<><Hourglass class="icon" aria-hidden="true" />{copy.surfaceLoading(props.label)}</>} aria-busy="true"><Show when={props.onClose}><button data-button="quiet" type="button" onClick={() => props.onClose?.()}>{copy.close}</button></Show></ReservedLine>;

  return <Errored fallback={(_error, reset) => fallback(<Show when={!isPending(loaded)} fallback={loading()}><ReservedLine message={copy.surfaceLoadFailed(props.label)} blocked recover={{ run: () => { affects(loaded); void refresh(loaded); reset(); } }} /></Show>)}>
    <Loading fallback={loading()}>
      <Show when={loaded()} keyed>{value => props.children(value)}</Show>
    </Loading>
  </Errored>;
};
