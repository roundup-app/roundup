import "./FirstRun.css";
import { createResource, For, Show } from "solid-js";
import { registerKeys } from "../keys/registry";
import { chordNamed } from "../keys/chords";
import { EmptyState } from "../ink/EmptyState";
import type { App } from "./seam";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";

/** Screen 11 of `docs/wireframes.md`: each region says what will live there; there is no tutorial. */
export const EmptyRail = (props: { onNew?: () => void; onWorkstream?: () => void; available?: boolean }) => (
  <EmptyState art="plant" {...{ title: copy.emptyRailTitle }} line={copy.emptyRailLine} actions={props.onWorkstream ? [
    { label: copy.newAgent, chord: chordNamed("agent.new")!, run: () => props.onNew?.() },
    { label: copy.newWorkstreamTitle, chord: chordNamed("workstream.new")!, run: () => props.onWorkstream?.() },
  ] : undefined} available={props.available} />
);

export const ChooseProject = (props: { app: App; failure: string | null; onOpen: (path: string) => void; onChoose: () => void; onRetry?: (() => void) | undefined }) => {
  const [recent, { refetch: refetchRecent }] = createResource(() => props.app.recentProjects().then(paths => ({ paths, failure: null })).catch((error: Error) => ({ paths: [], failure: error.message })));
  const [binary, { refetch: refetchBinary }] = createResource(() => props.app.claudeBinary().then(value => ({ value, failure: null })).catch((error: Error) => ({ value: null, failure: error.message })));

  registerKeys({ kind: "app" }, [{ action: chordNamed("project.choose-folder")!, capture: () => ({ available: () => true, invoke: () => props.onChoose() }) }]);

  return (
    <div class="choose-project">
      <ReservedLine message={props.failure} clearedBy={() => props.failure} action={<Show when={props.onRetry}>{retry => <button data-button="quiet" type="button" onClick={retry()}>{copy.retry}</button>}</Show>} />
      <Show when={!props.failure}><EmptyState art="strolling" {...{ title: copy.openAFolderToStart }} actions={[{ label: copy.chooseFolder, chord: chordNamed("project.choose-folder")!, run: props.onChoose }]} /></Show>
      <Show when={props.failure}><button data-button="primary" type="button" onClick={() => props.onChoose()}>{copy.chooseFolder}</button></Show>
      <Show when={recent()?.failure}>{failure => <ReservedLine message={failure()} clearedBy={recent} action={<button data-button="quiet" type="button" onClick={() => void refetchRecent()}>{copy.retry}</button>} />}</Show>
      <Show when={recent()?.paths.length}>
        <ul aria-label={copy.recentFolders}>
          <For each={recent()?.paths.slice(0, 5)}>{path => <li><button data-button="quiet" type="button" onClick={() => props.onOpen(path)}>{path}</button></li>}</For>
        </ul>
      </Show>
      <Show when={binary()}>{fact => <Show when={fact().value} fallback={<ReservedLine message={fact().failure ?? copy.claudeNotFound} clearedBy={binary} action={<button data-button="quiet" type="button" onClick={() => void refetchBinary()}>{copy.retry}</button>} />}>{value => <p>{copy.claudeBinary(value().version, value().path)}</p>}</Show>}</Show>
    </div>
  );
};

export const EmptyShelf = () => (
  <>
    <EmptyState art="running" {...{ title: copy.todos }} line={copy.emptyTodosLine} />
    <EmptyState art="reading-side" {...{ title: copy.pads }} line={copy.emptyPadsLine} />
  </>
);
