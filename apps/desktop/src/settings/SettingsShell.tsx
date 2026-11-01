import { captureFocus } from "../keys/focus";
import { For, onMount, Show, type JSX } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import "./styles.css";

/** U3764: the centre's settings view, shared by Project settings and App Settings: a title, a close control and named groups. Escape closes it. */
export const SettingsShell = (props: { heading: string; hideHeading?: boolean; onClose: () => void; children: JSX.Element }) => {
  let view!: HTMLElement;

  // Opening moves focus into the view, so Escape reaches its handler.
  const initialFocus = captureFocus();
  onMount(() => initialFocus(() => view.focus()));

  return (
  <section ref={view} tabindex="-1" class="settings-view" aria-label={props.heading} onKeyDown={event => { if (event.key === "Escape" && !event.isComposing && !event.defaultPrevented) { event.preventDefault(); props.onClose(); } }}>
    <Show when={!props.hideHeading}><header class="settings-head">
      <h2 class="settings-title">{props.heading}</h2>
      <button data-button="quiet" class="word" type="button" onClick={() => props.onClose()}>{copy.close}</button>
    </header></Show>
    {props.children}
  </section>
  );
};

export const SettingsGroup = (props: { name: string; hideHeading?: boolean; children: JSX.Element }) => (
  <section class="settings-group">
    {!props.hideHeading && <h3 class="settings-group-name">{props.name}</h3>}
    <div class="settings-rows" role="group" aria-label={props.name}>{props.children}</div>
  </section>
);

type Result = { id: string; page: string; group: string; label: string; description: string; hiddenHint?: boolean };

/** U5243a: one result per matching setting, with its place, its live control and its description. */
export const SettingsResults = (props: { results: Result[]; controls: Record<string, () => JSX.Element> }) => (
  <Show when={props.results.length > 0} fallback={<ReservedLine class="settings-no-results" status={copy.settingsNoResults} />}>
    <ul class="settings-results settings-rows" aria-label={copy.settingsResults}>
      <For each={props.results}>{result => <li class="settings-result">
        <p class="settings-place">{copy.settingsPlace(result.page, result.group)}</p>
        {props.controls[result.id]?.()}
        <Show when={result.hiddenHint}><p class="settings-hint">{result.description}</p></Show>
      </li>}</For>
    </ul>
  </Show>
);
