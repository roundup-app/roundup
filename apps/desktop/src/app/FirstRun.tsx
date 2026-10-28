import "./FirstRun.css";
import { createResource, For, Show } from "solid-js";
import { registerKeys } from "../keys/registry";
import { CHORDS } from "../keys/chords";
import { EmptyState } from "../ink/EmptyState";
import type { App } from "./seam";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";

/** Screen 11 of `docs/wireframes.md`: each region says what will live there; there is no tutorial. */
export const EmptyRail = (props: { onNew?: () => void }) => (
  <EmptyState art="circle" {...{ title: copy.emptyRailTitle }} line={copy.emptyRailLine} action={props.onNew ? <button type="button" data-button="primary" onClick={() => props.onNew?.()}>{copy.newAgent}</button> : undefined} chip={props.onNew ? "⌘N" : undefined} />
);

export const ChooseProject = (props: { app: App; failure: string | null; onOpen: (path: string) => void; onChoose: () => void; onRetry?: (() => void) | undefined }) => {
  const [recent] = createResource(() => props.app.recentProjects().then(paths => ({ paths, failure: null })).catch((error: Error) => ({ paths: [], failure: error.message })));
  const [binary] = createResource(() => props.app.claudeBinary().then(value => ({ value, failure: null })).catch((error: Error) => ({ value: null, failure: error.message })));

  registerKeys({ kind: "app" }, [{ action: CHORDS.find(chord => chord.keys === "⌘O")!, capture: () => ({ available: () => true, invoke: () => props.onChoose() }) }]);

  return (
    <div class="choose-project">
      <ReservedLine message={props.failure}><Show when={props.onRetry}>{retry => <button data-button="quiet" type="button" onClick={retry()}>{copy.retry}</button>}</Show></ReservedLine>
      <Show when={!props.failure}><EmptyState art="folder" {...{ title: copy.openAFolderToStart }} line={copy.emptyFolderLine} action={<button data-button="primary" type="button" onClick={() => props.onChoose()}>{copy.chooseFolder}</button>} chip="⌘O" /></Show>
      <Show when={props.failure}><button data-button="primary" type="button" onClick={() => props.onChoose()}>{copy.chooseFolder}</button></Show>
      <Show when={recent()?.failure}>{failure => <ReservedLine message={failure()} />}</Show>
      <Show when={recent()?.paths.length}>
        <ul aria-label={copy.recentFolders}>
          <For each={recent()?.paths.slice(0, 5)}>{path => <li><button data-button="quiet" type="button" onClick={() => props.onOpen(path)}>{path}</button></li>}</For>
        </ul>
      </Show>
      <Show when={binary()}>{fact => <Show when={fact().value} fallback={<ReservedLine message={fact().failure ?? copy.claudeNotFound} />}>{value => <p>{copy.claudeBinary(value().version, value().path)}</p>}</Show>}</Show>
    </div>
  );
};

export const EmptyShelf = () => (
  <>
    <EmptyState art="check" {...{ title: copy.todos }} line={copy.emptyTodosLine} />
    <EmptyState art="diamond" {...{ title: copy.pads }} line={copy.emptyPadsLine} />
  </>
);
