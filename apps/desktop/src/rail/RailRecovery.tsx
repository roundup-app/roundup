import { For, Show } from "solid-js";
import * as v from "valibot";
import { CopyButton } from "../ui/CopyButton";
import { ReservedLine } from "../ink/ReservedLine";
import { Icon } from "../ink/Icon";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import type { draftsOf } from "./persist/storage";

type Entry = ReturnType<ReturnType<typeof draftsOf>["records"]>[number];

export const RailRecovery = (props: {
  recovery: () => Entry[];
  revisions: () => ReadonlyMap<string, Entry>;
  destinationName: (id: string) => string;
  discard: (revision: string) => void;
}) => {
  const connected = useConnectedProject();
  const { project, rail } = connected;
  const failure = rail.commandFailure;
  const recovery = props.recovery;
  const revisions = props.revisions;
  const destinationName = props.destinationName;

  return (
    <Show when={recovery().length > 0}>
        <details class="rail-recovery">
          <summary><Icon name="right" />{copy.railDrafts}</summary>
          <For each={recovery().map((entry) => entry.revision).reverse()}>{(revision) => (
            <Show when={revisions().get(revision)}>{(entry) => {
              const text = () => {
                const value = entry().value.text;

                return v.is(v.string(), value) ? value : "";
              };

              const base = () => {
                const value = entry().value.base;

                return v.is(v.string(), value) ? value : null;
              };

              return (
                <details class="rail-recovery-detail" data-revision={entry().revision}>
                  <summary><Icon name="right" /><span>{copy.railDraftRecovery(entry().destination.surface, destinationName(entry().destination.object), entry().status)}</span></summary>
                  <ReservedLine status={entry().destination.object !== "" && entry().destination.object !== project.path && !rail.nodes.some((node) => node.id === entry().destination.object) ? copy.railDraftUnavailable : null} />
                  <textarea aria-label={copy.railDraftRecovered} readOnly value={text()} />
                  <p>{copy.railDraftDestination(project.name, destinationName(entry().destination.recipient ?? entry().destination.object))}</p>
                  <Show when={entry().destination.surface === "rail-task"}><p>{copy.railDraftTaskAction(entry().value.action === "note" || (entry().value.action === undefined && entry().destination.recipient !== null))}</p></Show>
                  <ReservedLine status={entry().destination.surface === "rail-name" && rail.nodes.some((node) => node.id === entry().destination.object && node.name !== entry().value.base) ? copy.railDraftConflict : null} />
                  <Show when={base()}>{(base) => <p>{copy.railDraftBase(base())}</p>}</Show>
                  <div class="rail-recovery-actions">
                  <CopyButton app={connected.app} identity={entry().revision} text={text()} onFailure={error => failure.show(error.message)}>{copy.railDraftCopy}</CopyButton>
                  <button data-button="quiet" onClick={() => { props.discard(entry().revision); }}>{copy.railDraftDiscard}</button>
                  </div>
                </details>
              );
            }}</Show>
          )}</For>
        </details>
    </Show>
  );
};
