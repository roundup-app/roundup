import "./import.css";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { ImportPeriod } from "@contracts/project/ImportPeriod";
import { copy } from "../copy";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";
import { Disclosure } from "../ui/Disclosure";

const PERIODS: readonly ImportPeriod[] = ["day", "week", "month"];

/** U2875d: the Project's `Import Claude Code work` panel. Opening discovers; nothing submits until `Import` is pressed, and a restored selection waits for a fresh discovery to match it. */
export const ImportPanel = (props: { open: boolean; opener: HTMLElement | undefined; onClose: () => void }) => {
  const { importing: state, drafts, project, daemonExit, now } = useConnectedProject();
  const [copyFailure, failCopy] = createSignal<string | null>(null);

  const copyItem = (text: string) => {
    void navigator.clipboard.writeText(text)
      .then(() => failCopy(null), error => failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))));
  };

  const release = drafts.editor({ surface: "import", object: project.path, recipient: null });
  onCleanup(release);
  const period = state.period;
  const wanted = state.selected;
  const found = state.discovery;
  const failure = state.failure;
  const refused = state.failed;
  const pending = state.pending;
  const discover = state.refresh;
  const choose = state.setPeriod;
  const confirm = state.confirm;
  const dismiss = () => { if (!pending()) props.onClose(); };

  let panel: HTMLElement | undefined;
  let periods: HTMLDivElement | undefined;
  registerKeys({ kind: "layer", element: () => panel, active: () => props.open, modal: true }, []);

  return (
    <Dialog.Root open={props.open} initialFocusEl={() => periods?.querySelector<HTMLElement>("[aria-pressed=true]") ?? null} finalFocusEl={() => props.opener?.isConnected ? props.opener : null}
      onOpenChange={(details) => { if (!details.open) dismiss(); }}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner>
        <Dialog.Content class="import-panel" ref={(element) => (panel = element)}>
          <Dialog.Title>{copy.importTitle}</Dialog.Title>
          <div role="group" aria-label={copy.importPeriod} class="import-period" ref={periods}>
            <For each={PERIODS}>{(each) => (
              <button type="button" data-button="quiet" aria-pressed={period() === each} onClick={() => choose(each)}>
                {copy.importPeriodName(each)}
              </button>
            )}</For>
          </div>
          <Show when={!state.verified() && wanted().size > 0}><p role="status">{copy.importRestored(wanted().size)}</p></Show>
          <Show when={state.hasConflict()}>
            <section class="import-recovery" aria-label={copy.importChoices}>
              <p role="status" aria-label={copy.importConflict}>{copy.importConflictExplanation}</p>
              <For each={state.choices()}>{(choice, at) => (
                <section aria-label={copy.importChoice(at() + 1)}>
                  <p>{copy.importPeriodName(choice.period)}</p>
                  <ul><For each={choice.sources}>{(_source, index) => <li>{choice.titles?.[index()] || copy.importUnnamed}</li>}</For></ul>
                  <div class="import-actions">
                    <button type="button" data-button="quiet" onClick={() => copyItem(JSON.stringify(choice, null, 2))}>{copy.copy}</button>
                    <button type="button" data-button="quiet" disabled={pending()} onClick={() => state.restoreChoice(choice.revision)}>{copy.importOpenChoice(at() + 1)}</button>
                    <button type="button" data-button="quiet" disabled={pending()} onClick={() => state.discardChoice(choice.revision)}>{copy.importDiscardChoice(at() + 1)}</button>
                  </div>
                </section>
              )}</For>
            </section>
          </Show>
          <Show when={state.restoreFailure() || state.retentionFailure()}>
            <p role="alert" data-kind="error" class="import-failure">{state.restoreFailure() ? copy.importRestoreFailure : copy.importRetentionFailure}</p>
            <p>{copy.importRetentionRecovery}</p>
            <button type="button" data-button="quiet" onClick={state.retryStorage}>{copy.retryStorage}</button>
          </Show>
          <Show when={failure()}>{(message) => <p role="alert" data-kind="error" class="import-failure">{message()}</p>}</Show>
          <Show when={found()} fallback={<Show when={state.loading()}><p role="status">{copy.importLooking}</p></Show>}>
            {(result) => <>
              <Show when={result().candidates.length === 0}><p role="status">{copy.importNone}</p></Show>
              <ul class="import-list" aria-label={copy.importResults}>
                <For each={result().candidates}>{(candidate) => (
                  <li class="import-candidate">
                    <Checkbox class="import-check" checked={wanted().has(candidate.source)} onCheckedChange={(checked) => state.choose(candidate.source, candidate.title, candidate.revision, checked)}>
                      <span class="import-title">{candidate.title || copy.importUnnamed}</span>
                      <span class="import-meta">
                        <span class="import-cwd"><bdi>{copy.importLocation(candidate.cwd, project.name)}</bdi></span>
                        <time dateTime={new Date(Number(candidate.last_activity_ms)).toISOString()}>{copy.importAge(Math.max(0, Math.floor((now() - Number(candidate.last_activity_ms)) / 60000)))}</time>
                        <Show when={refused().get(candidate.source)}>{(reason) => <span role="alert" data-kind="error" class="import-failure">{copy.importRowRefusal(reason())}</span>}</Show>
                      </span>
                    </Checkbox>
                    <button type="button" data-button="quiet" onClick={() => copyItem(JSON.stringify({ ...candidate, last_activity_ms: candidate.last_activity_ms.toString() }, null, 2))}>{copy.copy}</button>
                  </li>
                )}</For>
                <For each={[...refused()].filter(([source]) => !result().candidates.some((candidate) => candidate.source === source))}>{([source, reason]) => <li><div class="import-text import-unavailable"><span class="import-title">{wanted().get(source)?.title ?? copy.importUnnamed}</span><p role="alert" data-kind="error" class="import-failure">{reason}</p></div></li>}</For>
              </ul>
              <Show when={result().excluded.length > 0}>
                <Disclosure class="import-excluded" label={copy.importNotImportable(result().excluded.length)}>
                  <ul class="import-list">
                    <For each={result().excluded}>{(excluded) => <li class="import-candidate">
                      <div class="import-text"><span class="import-title">{excluded.title ?? (excluded.last_activity_ms === null ? copy.importUnnamed : new Date(Number(excluded.last_activity_ms)).toLocaleString())}</span>
                      <span class="import-meta">{copy.importExcludedReason(excluded.reason)}</span></div>
                      <button type="button" data-button="quiet" onClick={() => copyItem(JSON.stringify({ ...excluded, last_activity_ms: excluded.last_activity_ms?.toString() ?? null }, null, 2))}>{copy.copy}</button>
                    </li>}</For>
                  </ul>
                </Disclosure>
              </Show>
            </>}
          </Show>
          <Show when={copyFailure()}>{failure => <p role="alert">{failure()}</p>}</Show>
          <p class="import-words">
            <button data-button="quiet" type="button" class="word" onClick={() => void discover()}>{copy.importRefresh}</button>
            <span class="import-actions">
              <button data-button="quiet" type="button" class="word" onClick={dismiss}>{copy.cancel}</button>
              <button data-button="quiet" type="button" class="word import-confirm" disabled={daemonExit() !== null || pending() || !state.verified() || wanted().size === 0} onClick={() => void confirm()}>
                {copy.importConfirm(wanted().size)}
              </button>
            </span>
          </p>
        </Dialog.Content>
      </Dialog.Positioner></Portal>
    </Dialog.Root>
  );
};
