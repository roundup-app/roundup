import { Show } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { Icon } from "../ink/Icon";
import { KIND_ICON } from "../ink/kindIcon";
import { KeyChip } from "../keys/KeyChip";
import { ariaShortcut } from "../keys/chords";
import { captureActions } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import type { draftsOf } from "./persist/storage";

export const RailFooter = (props: {
  retained: ReturnType<typeof draftsOf>;
  asking: () => boolean;
  canSpawn: () => boolean;
  createWorkstream: () => void;
  openCreateMode: () => void;
}) => {
  const { project, rail } = useConnectedProject();
  const failure = rail.commandFailure;
  const { retained, asking, canSpawn, createWorkstream } = props;
  const dismissalLine = () => !(failure.surface() === "rail" && failure.message()) && !rail.storageFailure() && rail.unsavedDismissal() !== null;

  return (
      <div class="rail-footer">
        <ReservedLine content={failure.message()?.startsWith(`${copy.newAgent}: `) ? <span>{failure.message()!.slice(0, copy.newAgent.length + 2)}<span>{failure.message()!.slice(copy.newAgent.length + 2)}</span></span> : undefined} class="rail-command-notice" overlay={!failure.retry() && !dismissalLine()} message={(failure.surface() === "rail" ? failure.message() : null) ?? rail.storageFailure() ?? (rail.unsavedDismissal() !== null ? copy.dismissalUnsaved(rail.unsavedDismissal()!) : null) ?? (retained.problem()?.destination?.surface.startsWith("rail-") ? copy.railDraftRetention(project.name, retained.problem()!.destination?.surface ?? "rail", retained.problem()!.operation) : null)}
          status={asking() ? copy.askingTheDoor : retained.records().some(entry => entry.destination.surface.startsWith("rail-") && entry.status === "unknown") ? copy.railDraftUnknown(project.name) : null}>
          <Show when={failure.retry()}>{retry => <>
            <button type="button" data-button="quiet" onClick={() => retry()()}>{copy.retry}</button>
            <button type="button" data-button="quiet" onClick={failure.clear}>{copy.dismiss}</button>
          </>}</Show>
          <Show when={dismissalLine()}><button type="button" data-button="quiet" onClick={() => rail.retryDismissal()}>{copy.retry}</button><button type="button" data-button="quiet" onClick={() => rail.clearUnsavedDismissal()}>{copy.dismiss}</button></Show>
          <Show when={retained.problem()?.destination?.surface.startsWith("rail-")}><button data-button="quiet" onClick={() => retained.retry()}>{copy.railDraftRetry}</button></Show>
        </ReservedLine>
        <div class="rail-actions">
          <button type="button" data-button="add" class="word" aria-label={copy.addWorkstream} aria-keyshortcuts={ariaShortcut("⌥⌘N")} aria-disabled={canSpawn() ? undefined : true} onClick={() => { if (canSpawn()) createWorkstream(); }}><Icon name={KIND_ICON.workstream} />{copy.addWorkstreamWord}<KeyChip keys="⌥⌘N" /></button>
          <button type="button" data-button="add" class="word" aria-label={copy.newMode} aria-keyshortcuts={ariaShortcut("⇧⌘M")} aria-disabled={canSpawn() ? undefined : true} onClick={() => { if (canSpawn()) props.openCreateMode(); }}><Icon name={KIND_ICON.mode} />{copy.modeWord}<KeyChip keys="⇧⌘M" /></button>
          <button type="button" data-button="add" class="word" aria-label={copy.newAgent} aria-keyshortcuts={ariaShortcut("⌘N")} aria-disabled={canSpawn() ? undefined : true} onClick={() => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘N")?.run()}><Icon name={KIND_ICON.agent} />{copy.addAgentWord}<KeyChip keys="⌘N" /></button>
        </div>
      </div>
  );
};
