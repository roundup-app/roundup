import "./FirstRun.css";
import { createResource, For, Show } from "solid-js";
import { registerKeys } from "../keys/registry";
import { CHORDS } from "../keys/chords";
import { EmptyState } from "../ink/EmptyState";
import type { App } from "../app/seam";
import { copy } from "../app/copy";
import { dismissable, ReservedLine } from "../ink/ReservedLine";

/** Screen 11 of `docs/wireframes.md`: each region says what will live there; there is no tutorial. */
export const EmptyRail = (props: { onNew?: () => void; onWorkstream?: () => void; available?: boolean }) => (
  <EmptyState art="plant" {...{ title: copy.emptyRailTitle }} line={copy.emptyRailLine} actions={props.onWorkstream ? [
    { label: copy.newAgent, chord: CHORDS["agent.new"], run: () => props.onNew?.() },
    { label: copy.newWorkstreamTitle, chord: CHORDS["workstream.new"], run: () => props.onWorkstream?.() },
  ] : undefined} available={props.available} />
);

export const ChooseProject = (props: { app: App; failure: string | null; onOpen: (path: string) => void; onChoose: () => void; onRetry?: (() => void) | undefined }) => {
  const [recent, { refetch: refetchRecent }] = createResource(() => props.app.recentProjects().then(paths => ({ paths, failure: null })).catch((error: Error) => ({ paths: [], failure: error.message })));
  const [binary, { refetch: refetchBinary }] = createResource(() => props.app.claudeBinary().then(value => ({ value, failure: null })).catch((error: Error) => ({ value: null, failure: error.message })));

  const failureLine = dismissable(() => props.failure);
  const recentLine = dismissable(() => recent()?.failure);
  const binaryLine = dismissable(() => binary() && !binary()!.value ? binary()!.failure ?? copy.claudeNotFound : null);

  registerKeys({ kind: "app" }, [{ action: CHORDS["project.choose-folder"], capture: () => ({ available: () => true, invoke: () => props.onChoose() }) }]);

  return (
    <div class="choose-project">
      <ReservedLine message={failureLine.message()} dismiss={failureLine.dismiss} recover={props.onRetry ? { run: props.onRetry } : undefined} />
      <Show when={!props.failure}><EmptyState art="strolling" {...{ title: copy.openAFolderToStart }} actions={[{ label: copy.chooseFolder, chord: CHORDS["project.choose-folder"], run: props.onChoose }]} /></Show>
      <Show when={props.failure}><button data-button="primary" type="button" onClick={() => props.onChoose()}>{copy.chooseFolder}</button></Show>
      <Show when={recent()?.failure}><ReservedLine message={recentLine.message()} dismiss={recentLine.dismiss} recover={{ run: () => void refetchRecent() }} /></Show>
      <Show when={recent()?.paths.length}>
        <ul aria-label={copy.recentFolders}>
          <For each={recent()?.paths.slice(0, 5)}>{path => <li><button data-button="quiet" type="button" onClick={() => props.onOpen(path)}>{path}</button></li>}</For>
        </ul>
      </Show>
      <Show when={binary()}>{fact => <Show when={fact().value} fallback={<ReservedLine message={binaryLine.message()} dismiss={binaryLine.dismiss} recover={{ run: () => void refetchBinary() }} />}>{value => <p>{copy.claudeBinary(value().version, value().path)}</p>}</Show>}</Show>
    </div>
  );
};

export const EmptyShelf = () => (
  <>
    <EmptyState art="running" {...{ title: copy.todos }} line={copy.emptyTodosLine} />
    <EmptyState art="reading-side" {...{ title: copy.pads }} line={copy.emptyPadsLine} />
  </>
);
