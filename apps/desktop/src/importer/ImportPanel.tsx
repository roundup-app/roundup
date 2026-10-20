import "./import.css";
import { For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { ImportPeriod } from "@contracts/project/ImportPeriod";
import { copy } from "../copy";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";

const PERIODS: readonly ImportPeriod[] = ["day", "week", "month"];

/** U2875d: the Project's `Import Claude Code work` panel. Opening discovers; nothing submits until `Import` is pressed, and a restored selection waits for a fresh discovery to match it. */
export const ImportPanel = (props: { open: boolean; opener: HTMLElement | undefined; onClose: () => void }) => {
  const { importing: state, drafts, project, daemonExit } = useConnectedProject();
  const release = drafts.editor({ surface: "import", object: project.path, recipient: null });
  onCleanup(release);
  const period = state.period;
  const wanted = state.selected;
  const found = state.discovery;
  const failure = state.failure;
  const refused = state.failed;
  const pending = state.pending;
  const stale = state.stale;
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
      <Portal><Dialog.Backdrop /><Dialog.Positioner class="import-positioner">
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
          <Show when={state.restoreFailure() || state.retentionFailure()}>
            <p role="alert" class="import-failure">{state.restoreFailure() ? copy.importRestoreFailure : copy.importRetentionFailure}</p>
            <p>{copy.importRetentionRecovery}</p>
            <button type="button" data-button="quiet" onClick={state.retryStorage}>{copy.retryStorage}</button>
          </Show>
          <Show when={failure()}>{(message) => <p role="alert" class="import-failure">{message()}</p>}</Show>
          <Show when={found()} fallback={<Show when={state.loading()}><p role="status">{copy.importLooking}</p></Show>}>
            {(result) => <>
              <Show when={result().candidates.length === 0}><p role="status">{copy.importNone}</p></Show>
              <Show when={stale().length > 0}><p role="status">{copy.importStale(stale())}</p></Show>
              <ul class="import-list" aria-label={copy.importResults}>
                <For each={result().candidates}>{(candidate) => (
                  <li>
                    <Checkbox class="import-check" checked={wanted().has(candidate.source)} onCheckedChange={(checked) => state.choose(candidate.source, candidate.title, candidate.revision, checked)}>
                      <span class="import-text">
                        <span class="import-title">{candidate.title}</span>
                        <span class="import-cwd"><bdi>{candidate.cwd === "" ? copy.importProjectFolder : candidate.cwd}</bdi></span>
                        <time class="import-activity" dateTime={new Date(Number(candidate.last_activity_ms)).toISOString()}>{new Date(Number(candidate.last_activity_ms)).toLocaleString()}</time>
                      </span>
                    </Checkbox>
                    <Show when={refused().get(candidate.source)}>{(reason) => <div class="import-error"><p role="alert" class="import-failure">{reason()}</p></div>}</Show>
                  </li>
                )}</For>
                <For each={result().excluded}>{(excluded) => <li><div class="import-text import-unavailable"><span class="import-title">{excluded.source}</span><p role="alert" class="import-failure">{excluded.reason}</p></div></li>}</For>
                <For each={[...refused()].filter(([source]) => !result().candidates.some((candidate) => candidate.source === source))}>{([source, reason]) => <li><div class="import-text import-unavailable"><span class="import-title">{source}</span><p role="alert" class="import-failure">{reason}</p></div></li>}</For>
              </ul>
            </>}
          </Show>
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
