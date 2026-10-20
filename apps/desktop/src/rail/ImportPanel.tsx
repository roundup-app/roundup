import { For, Show } from "solid-js";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { Checkbox } from "../ui/Checkbox";
import { Select } from "../ui/Select";
import type { ImportPeriod } from "@contracts/project/ImportPeriod";
import type { ImportState } from "./importState";

const PERIODS: { value: ImportPeriod; label: string }[] = [
  { value: "day", label: copy.importDay },
  { value: "week", label: copy.importWeek },
  { value: "month", label: copy.importMonth },
];

/** U2875d: the Rail's `Import Claude Code work` panel: a period, individually chosen conversations, confirm and cancel. Escape cancels. */
export const ImportPanel = (props: { state: ImportState; disabled: boolean }) => {
  const s = () => props.state;

  return (
    <section class="rail-import" aria-label={copy.importWork}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) s().cancel(); }}>
      <Select label={copy.importPeriod} choices={PERIODS} value={s().period()} onValueChange={(value) => PERIODS.filter((period) => period.value === value).forEach((chosen) => s().setPeriod(chosen.value))} />
      <div class="rail-import-scroll">
      <Show when={!s().verified() && s().selected().size > 0}>
        <p role="status" class="light">{copy.importRestored(s().selected().size)}</p>
      </Show>
      <Show when={!s().verified() && !s().loading()}>
        <button data-button="quiet" class="word" onClick={() => void s().refresh()}>{copy.importRefresh}</button>
      </Show>
      <Show when={s().stale().length > 0}>
        <p role="status" class="light">{copy.importStale(s().stale())}</p>
        <button data-button="quiet" class="word" onClick={() => void s().refresh()}>{copy.importRefresh}</button>
      </Show>
      <Show when={s().loading()}><p role="status" class="light">{copy.importLooking}</p></Show>
      <Show when={s().discovery()}>{(found) => (
        <>
          <Show when={found().candidates.length === 0 && found().excluded.length === 0}><p class="light">{copy.importNone}</p></Show>
          <ul class="rail-import-list">
            <For each={found().candidates}>{(candidate) => (
              <li>
                <Checkbox checked={s().selected().has(candidate.source)} disabled={s().pending()} onCheckedChange={(chosen) => s().choose(candidate.source, candidate.title, candidate.revision, chosen)}>
                  <span class="rail-import-title">{candidate.title}</span>
                  <Show when={candidate.cwd !== ""}><span class="light rail-import-cwd">{candidate.cwd}</span></Show>
                </Checkbox>
                <Show when={s().failed().get(candidate.source)}>{(cause) => <ErrorLine message={cause()} />}</Show>
              </li>
            )}</For>
            <For each={found().excluded}>{(entry) => <li class="light" aria-disabled="true">{copy.importUnavailable(entry.reason)}</li>}</For>
          </ul>
        </>
      )}</Show>
      <Show when={s().failure()}>{(message) => <ErrorLine message={message()} />}</Show>
      </div>
      <div class="rail-import-actions">
        <button data-button="quiet" class="word" aria-disabled={props.disabled || s().pending() || !s().verified() || s().selected().size === 0 ? true : undefined}
          onClick={() => { if (!props.disabled) void s().confirm(); }}>
          {s().failed().size > 0 ? copy.importRetry : copy.importConfirm(s().selected().size)}</button>
        <button data-button="quiet" class="word" onClick={() => s().cancel()}>{copy.importCancel}</button>
      </div>
    </section>
  );
};
