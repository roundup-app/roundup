import { createSignal, For, Show } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { Icon } from "../ink/Icon";
import { KIND_ICON } from "../ink/kindIcon";
import { KeyChip } from "../keys/KeyChip";
import { CHORDS, ariaShortcut } from "../keys/chords";
import { activationSource, captureActions } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { Menu } from "../ui/Menu";
import { Portal } from "solid-js/web";
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

  const [open, setOpen] = createSignal(false);
  const [pointer, setPointer] = createSignal(false);

  const choices = [
    { kind: "agent", name: "agent.new", label: copy.addAgentWord.trim(), run: () => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘N")?.run() },
    { kind: "workstream", name: "workstream.new", label: copy.addWorkstreamWord.trim(), run: createWorkstream },
    { kind: "mode", name: "mode.new", label: copy.modeWord, run: props.openCreateMode },
  ] as const;

  return (
      <div class="rail-footer">
        <ReservedLine content={failure.message()?.startsWith(`${copy.newAgent}: `) ? <span>{failure.message()!.slice(0, copy.newAgent.length + 2)}<span>{failure.message()!.slice(copy.newAgent.length + 2)}</span></span> : undefined} class="rail-command-notice" message={(failure.surface() === "rail" ? failure.message() : null) ?? rail.storageFailure() ?? (rail.unsavedDismissal() !== null ? copy.dismissalUnsaved(rail.unsavedDismissal()!) : null) ?? (retained.problem()?.destination?.surface.startsWith("rail-") ? copy.railDraftRetention(project.name, retained.problem()!.destination?.surface ?? "rail", retained.problem()!.operation) : null)}
          status={asking() ? copy.askingTheDoor : retained.records().some(entry => entry.destination.surface.startsWith("rail-") && entry.status === "unknown") ? copy.railDraftUnknown(project.name) : null}>
          <Show when={failure.retry()}>{retry => <>
            <button type="button" data-button="quiet" onClick={() => retry()()}>{copy.retry}</button>
            <button type="button" data-button="quiet" onClick={failure.clear}>{copy.dismiss}</button>
          </>}</Show>
          <Show when={dismissalLine()}><button type="button" data-button="quiet" onClick={() => rail.retryDismissal()}>{copy.retry}</button><button type="button" data-button="quiet" onClick={() => rail.clearUnsavedDismissal()}>{copy.dismiss}</button></Show>
          <Show when={retained.problem()?.destination?.surface.startsWith("rail-")}><button data-button="quiet" onClick={() => retained.retry()}>{copy.railDraftRetry}</button></Show>
        </ReservedLine>
        <div class="rail-actions">
          <Menu.Root open={open()} onOpenChange={details => { if (!details.open || canSpawn()) setOpen(details.open); }} positioning={{ placement: "top-start" }} onSelect={({ value }) => { if (canSpawn()) choices.find(choice => choice.kind === value)?.run(); }}>
            <Menu.Trigger onPointerDown={() => setPointer(true)} onKeyDown={() => setPointer(false)} onClick={event => setPointer(activationSource(event) === "pointer")} data-button="add" aria-label={copy.create} aria-disabled={canSpawn() ? undefined : true}><Icon name="plus" /></Menu.Trigger>
            <Portal><Menu.Positioner><Menu.Content aria-label={copy.create} class="rail-create-menu" data-pointer={pointer() || undefined}>
              <For each={choices}>{choice => {
                const keys = CHORDS.find(chord => chord.name === choice.name)!.keys;

                return <Menu.Item value={choice.kind} disabled={!canSpawn()} aria-keyshortcuts={ariaShortcut(keys)}><Icon name={KIND_ICON[choice.kind]} />{choice.label}<KeyChip keys={keys} /></Menu.Item>;
              }}</For>
            </Menu.Content></Menu.Positioner></Portal>
          </Menu.Root>
        </div>
      </div>
  );
};
