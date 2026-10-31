import { KindGlyph } from "../ink/KindGlyph";
import { CopyButton } from "../ui/CopyButton";
import { ReservedLine } from "../ink/ReservedLine";
import "./import.css";
import { createSignal, For, onCleanup, Show } from "solid-js";
import type { ImportPeriod } from "@contracts/project/ImportPeriod";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { createRowCollection, rowKey } from "../ui/RowCollection";
import { Checkbox } from "../ui/Checkbox";
import { SettingsGroup, SettingsShell } from "../settings/SettingsShell";
import { Disclosure } from "../ui/Disclosure";

const PERIODS: readonly ImportPeriod[] = ["day", "week", "month"];

/** U2875d: the Project's `Import Claude Code` panel. Opening discovers; nothing submits until `Import` is pressed, and a restored selection waits for a fresh discovery to match it. */
export const ImportPanel = (props: { onClose: () => void }) => {
  const { app, importing: state, drafts, project, rail, daemonExit, now, events } = useConnectedProject();
  const [copyFailure, failCopy] = createSignal<string | null>(null);

  const release = drafts.editor({ surface: "import", object: project.path, recipient: null });
  onCleanup(release);
  onCleanup(events.subscribe(event => {
    if (state.listingAgent() && event.name === "rail.changed" && event.actor.id === state.listingAgent()) void state.refresh();
  }));
  const listing = () => rail.nodes.find(node => node.id === state.listingAgent());
  const period = state.period;
  const wanted = state.selected;
  const found = state.discovery;
  const failure = state.failure;
  const refused = state.failed;
  const uncertain = () => !state.verified() && [...refused().values()].some(failure => copy.importRowRefusal(failure) === null);
  const pending = state.pending;
  const discover = state.refresh;
  const choose = state.setPeriod;
  const confirm = state.confirm;
  const heads = new Map<string, HTMLInputElement>();

  const toggle = (source: string) => {
    const candidate = found()?.candidates.find(candidate => candidate.source === source);

    if (candidate) void state.choose(source, candidate.title, candidate.revision, !wanted().has(source));
  };

  const content = createRowCollection(() => (found()?.candidates ?? []).filter(candidate => {
    const head = heads.get(candidate.source);

    return head && !head.closest("[hidden], [inert], [disabled], [aria-disabled=true]");
  }).map(candidate => ({ value: candidate.source, label: candidate.title || copy.importUnnamed })), {
    onActivate: toggle,
  }, {
    selectedValues: () => [...wanted().keys()],
    isSelected: value => value !== null && wanted().has(value),
    isEmpty: () => wanted().size === 0,
    clear: () => { void state.selectSources([]); },
    setSelectedValues: values => { void state.selectSources(values); },
    replace: value => { void state.selectSources(value === null ? [] : [value]); },
    toggle,
  });

  const head = (source: string, element: HTMLInputElement) => {
    heads.set(source, element);
    content.register(element, source);
    onCleanup(() => heads.delete(source));
  };

  const dismiss = () => { if (!pending()) props.onClose(); };

  return (
    <SettingsShell heading={copy.importTitle} onClose={dismiss}>
      <div class="import-content">
      <SettingsGroup name={copy.importPrompt}>
        <div class="import-instructions">
          <textarea rows={1} class="import-prompt" aria-label={copy.importPrompt} value={state.prompt()} spellcheck={false} autocorrect="off" autocapitalize="off" onInput={event => void state.setPrompt(event.currentTarget.value)} />
          <button type="button" data-button="quiet" disabled={daemonExit() !== null || pending() || state.starting() || state.prompt().trim().length === 0} onClick={() => void state.start()}>{copy.importStart}</button>
        </div>
        <ReservedLine message={state.startFailure()} />
      </SettingsGroup>
      <SettingsGroup name={copy.importPeriod}>
          <div role="group" aria-label={copy.importPeriod} class="import-period">
            <For each={PERIODS}>{(each) => (
              <button type="button" data-button="quiet" aria-pressed={period() === each} onClick={() => choose(each)}>
                {copy.importPeriodName(each)}
              </button>
            )}</For>
          </div>
      </SettingsGroup>
      <SettingsGroup name={copy.importResults}><div class="import-panel">
          <ReservedLine status={state.listingAgent() && !found()?.candidates.length ? copy.importListing(listing()?.name ?? copy.importAgentName) : null}
            content={<span class="import-listing"><KindGlyph kind={listing()?.status?.kind ?? "working"} /><span>{copy.importListing(listing()?.name ?? copy.importAgentName)}</span></span>} />
          <ReservedLine message={failure() ?? (state.restoreFailure() || state.retentionFailure() ? `${state.restoreFailure() ? copy.importRestoreFailure : copy.importRetentionFailure} ${copy.importRetentionRecovery}` : null) ?? (uncertain() ? copy.importUnconfirmed : null)}
            aria-live="polite" aria-label={state.hasConflict() ? copy.importConflict : undefined} status={state.hasConflict() ? copy.importConflictExplanation : !state.verified() && wanted().size > 0 ? copy.importRestored(wanted().size) : state.loading() ? copy.importLooking : found()?.candidates.length === 0 ? copy.importNone : null}>
            <Show when={state.restoreFailure() || state.retentionFailure()}><button type="button" data-button="quiet" onClick={state.retryStorage}>{copy.retryStorage}</button></Show>
          </ReservedLine>
          <Show when={state.hasConflict()}>
            <section class="import-recovery" aria-label={copy.importChoices}>
              <For each={state.choices()}>{(choice, at) => (
                <section aria-label={copy.importChoice(at() + 1)}>
                  <p>{copy.importPeriodName(choice.period)}</p><p>{choice.prompt}</p>
                  <ul><For each={choice.sources}>{(_source, index) => <li>{choice.titles?.[index()] || copy.importUnnamed}</li>}</For></ul>
                  <div class="import-actions">
                    <CopyButton app={app} text={JSON.stringify(choice, null, 2)} onSuccess={() => failCopy(null)} onFailure={error => failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton>
                    <button type="button" data-button="quiet" disabled={pending()} onClick={() => state.restoreChoice(choice.revision)}>{copy.importOpenChoice(at() + 1)}</button>
                    <button type="button" data-button="quiet" disabled={pending()} onClick={() => state.discardChoice(choice.revision)}>{copy.importDiscardChoice(at() + 1)}</button>
                  </div>
                </section>
              )}</For>
            </section>
          </Show>
          <Show when={found()}>
            {(result) => <>
              <ul class="import-list" aria-label={copy.importResults}>
                <For each={result().candidates}>{(candidate) => (
                  <li class="import-candidate">
                    <Checkbox class="import-check" inputRef={element => head(candidate.source, element)} onKeyDown={rowKey} onClickCapture={event => {
                      if (event.ctrlKey || !event.metaKey && !event.shiftKey) return;
                      event.preventDefault(); event.stopPropagation();
                      // Let native canceled-checkbox activation roll back before Ark syncs the retained choice.
                      queueMicrotask(() => content.click(event));
                    }} checked={wanted().has(candidate.source)} onCheckedChange={(checked) => state.choose(candidate.source, candidate.title, candidate.revision, checked)}>
                      <span class="import-title">{candidate.title || copy.importUnnamed}</span>
                      <span class="import-meta">
                        <span class="import-cwd"><bdi>{copy.importLocation(candidate.cwd, project.name)}</bdi></span>
                        <time dateTime={new Date(Number(candidate.last_activity_ms)).toISOString()}>{copy.importAge(Math.max(0, Math.floor((now() - Number(candidate.last_activity_ms)) / 60000)))}</time>
                        <ReservedLine message={refused().get(candidate.source) ? (copy.importRowRefusal((refused().get(candidate.source))!)) : null} />
                      </span>
                    </Checkbox>
                    <CopyButton app={app} text={JSON.stringify({ ...candidate, error: refused().get(candidate.source) ?? null, last_activity_ms: candidate.last_activity_ms.toString() }, null, 2)} onSuccess={() => failCopy(null)} onFailure={error => failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton>
                  </li>
                )}</For>
                <For each={[...refused()].filter(([source]) => !result().candidates.some((candidate) => candidate.source === source))}>{([source, reason]) => <li class="import-candidate"><div class="import-text"><span class="import-title">{wanted().get(source)?.title ?? copy.importUnnamed}</span><ReservedLine message={copy.importRowRefusal(reason)} /></div><CopyButton app={app} text={JSON.stringify({ source, error: reason }, null, 2)} onSuccess={() => failCopy(null)} onFailure={error => failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton></li>}</For>
              </ul>
              <Show when={result().excluded.length > 0}>
                <Disclosure class="import-excluded" label={copy.importNotImportable(result().excluded.length)}>
                  <ul class="import-list">
                    <For each={result().excluded}>{(excluded) => <li class="import-candidate">
                      <div class="import-text"><span class="import-title">{excluded.title ?? (excluded.last_activity_ms === null ? copy.importUnnamed : new Date(Number(excluded.last_activity_ms)).toLocaleString())}</span>
                      <span class="import-meta">{copy.importExcludedReason(excluded.cause)}</span></div>
                      <CopyButton app={app} text={JSON.stringify({ ...excluded, last_activity_ms: excluded.last_activity_ms?.toString() ?? null }, null, 2)} onSuccess={() => failCopy(null)} onFailure={error => failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error)))}>{copy.copy}</CopyButton>
                    </li>}</For>
                  </ul>
                </Disclosure>
              </Show>
            </>}
          </Show>
          <ReservedLine message={copyFailure()} />
      </div></SettingsGroup>
      </div>
          <p class="import-words">
            <button data-button="quiet" type="button" class="word" onClick={() => void discover()}>{copy.importRefresh}</button>
            <span class="import-actions">
              <button data-button="primary" type="button" class="word import-confirm" disabled={daemonExit() !== null || pending() || state.starting() || !state.verified() || wanted().size === 0} onClick={() => void confirm()}>
                {copy.importConfirm(wanted().size)}
              </button>
            </span>
          </p>
    </SettingsShell>
  );
};
