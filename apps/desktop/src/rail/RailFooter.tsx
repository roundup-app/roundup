import { Disclosure } from "../ui/Disclosure";
import { KindGlyph } from "../ink/KindGlyph";
import { createSignal, For, Show } from "solid-js";
import { dismissable, type Dismissible } from "../ink/ReservedLine";
import { createMessageToast } from "../ink/messageToast";
import { StatusNote } from "../ink/MountedLine";
import { Icon } from "../ink/Icon";
import { KIND_ICON } from "../ink/kindIcon";
import { KeyChip } from "../keys/KeyChip";
import { ariaChord, CHORDS } from "../keys/chords";
import { activationSource, captureActions } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { Menu } from "../ui/Menu";
import type { draftsOf } from "../state/railStorage";

export const RailFooter = (props: {
  retained: ReturnType<typeof draftsOf>;
  asking: () => boolean;
  canSpawn: () => boolean;
  createWorkstream: () => void;
  openCreateMode: () => void;
}) => {
  const { project, rail, held } = useConnectedProject();
  const failure = rail.commandFailure;
  const { retained, asking, canSpawn, createWorkstream } = props;
  const storageLine = dismissable(() => rail.storageFailure());
  const draftLine = dismissable(() => retained.problem()?.destination?.surface.startsWith("rail-") ? copy.railDraftRetention(project.name, retained.problem()!.destination?.surface ?? "rail", retained.problem()!.operation) : null);

  /** The first failure the footer has, with how the owner recovers from that one. */
  const line = (): { message: string | null } & Dismissible => {
    const command = failure.surface() === "rail" ? failure.message() : null;

    if (command) {
      const retry = failure.retry();

      return { message: command, dismiss: failure.clear, recover: retry ? { run: () => retry() } : undefined };
    }

    if (storageLine.message()) return { message: storageLine.message() || null, dismiss: storageLine.dismiss };

    if (rail.unsavedDismissal() !== null) return { message: copy.dismissalUnsaved(rail.unsavedDismissal()!), dismiss: () => rail.clearUnsavedDismissal(), recover: { run: () => rail.retryDismissal() } };

    return { message: draftLine.message() || null, dismiss: draftLine.dismiss, recover: { run: () => retained.retry(), label: copy.railDraftRetry } };
  };

  const newAgentFailure = () => failure.message()?.startsWith(`${copy.newAgent}: `) ? <span>{failure.message()!.slice(0, copy.newAgent.length + 2)}<span>{failure.message()!.slice(copy.newAgent.length + 2)}</span></span> : undefined;

  createMessageToast({
    get message() { return line().message; },
    get content() { return newAgentFailure(); },
    dismiss: () => line().dismiss(),
    get recover() { return line().recover; },
  });

  let footer: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [pointer, setPointer] = createSignal(false);

  const choices = [
    { kind: "agent", name: "agent.new" as const, label: copy.addAgentWord.trim(), run: () => captureActions(document.activeElement).find(action => action.name === "agent.new")?.run() },
    { kind: "workstream", name: "workstream.new" as const, label: copy.addWorkstreamWord.trim(), run: createWorkstream },
    { kind: "mode", name: "mode.new" as const, label: copy.modeWord, run: props.openCreateMode },
  ] as const;

  return (
      <div class="rail-footer" ref={element => { footer = element; }}>
        <StatusNote text={asking() ? copy.askingTheDoor : retained.records().some(entry => entry.destination.surface.startsWith("rail-") && entry.status === "unknown") ? copy.railDraftUnknown(project.name) : null} />
        <Show when={held.rows().length}><Disclosure label={copy.held(held.rows().length)}>
          <For each={held.rows()}>{row => <button type="button" data-button="quiet" class="held-row" onClick={() => {
            // U6249d: a held row whose Agent is gone drops without a message.
            if (!rail.nodes.some(node => node.id === row.agent)) return held.acknowledge(row.agent);

            rail.select(row.agent, "open");
          }}><KindGlyph kind={row.kind} /><span class="held-content"><span>{row.name}</span><span class="held-line">{row.line}</span></span><time datetime={new Date(row.at).toISOString()}>{copy.time(row.at)}</time></button>}</For>
        </Disclosure></Show>
        <div class="rail-actions">
          <Menu.Root open={open()} onOpenChange={details => { if (!details.open || canSpawn()) setOpen(details.open); }} onAction={value => { if (canSpawn()) choices.find(choice => choice.kind === value)?.run(); }}>
            <Menu.Trigger onPointerDown={() => setPointer(true)} onKeyDown={() => setPointer(false)} onClick={event => setPointer(activationSource(event) === "pointer")} data-button="add" aria-label={copy.create} aria-disabled={canSpawn() ? undefined : "true"}><Icon name="plus" /></Menu.Trigger>
            <Menu.Content side="top" align="start" anchor={failure.surface() === "rail" && failure.retry() && footer ? footer : null} aria-label={copy.create} class="rail-create-menu" data-pointer={pointer() ? "true" : undefined}>
              <For each={choices}>{choice => {
                const chord = () => CHORDS[choice.name];

                return <Menu.Item value={choice.kind} disabled={!canSpawn()} aria-keyshortcuts={ariaChord(chord())}><Icon name={KIND_ICON[choice.kind]} />{choice.label}<KeyChip keys={chord().keys} /></Menu.Item>;
              }}</For>
            </Menu.Content>
          </Menu.Root>
        </div>
      </div>
  );
};
