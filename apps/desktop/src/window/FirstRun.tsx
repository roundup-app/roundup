import "./FirstRun.css";
import { createMemo, For, refresh, Show } from "solid-js";
import { registerKeys } from "../keys/registry";
import { CHORDS } from "../keys/chords";
import { EmptyState } from "../ink/EmptyState";
import type { App } from "../app/seam";
import { copy } from "./copy";
import { dismissable } from "../ink/recovery";
import { createMessageToast } from "../ink/messageToast";

export const ChooseProject = (props: { app: App; failure: string | null; onOpen: (path: string) => void; onChoose: () => void; onRetry?: (() => void) | undefined }) => {
  const readRecent = () => props.app.recentProjects().then(paths => ({ paths, failure: null })).catch((error: Error) => ({ paths: [], failure: error.message }));
  const readBinary = () => props.app.claudeBinary().then(value => ({ value, failure: null })).catch((error: Error) => ({ value: null, failure: error.message }));
  const recent = createMemo<Awaited<ReturnType<typeof readRecent>> | undefined>(readRecent, { loadingValue: undefined });
  const binary = createMemo<Awaited<ReturnType<typeof readBinary>> | undefined>(readBinary, { loadingValue: undefined });

  const failureLine = dismissable(() => props.failure);
  const recentLine = dismissable(() => recent()?.failure);
  const binaryLine = dismissable(() => binary() && !binary()!.value ? binary()!.failure ?? copy.claudeNotFound : null);

  createMessageToast({ started: true, get message() { return failureLine.message(); }, dismiss: failureLine.dismiss, get recover() { return props.onRetry ? { run: props.onRetry } : undefined; } });
  createMessageToast({ started: true, get message() { return recentLine.message(); }, dismiss: recentLine.dismiss, recover: { run: () => refresh(recent) } });
  createMessageToast({ started: true, get message() { return binaryLine.message(); }, dismiss: binaryLine.dismiss, recover: { run: () => refresh(binary) } });

  registerKeys({ kind: "app" }, [{ action: CHORDS["project.choose-folder"], capture: () => ({ available: () => true, invoke: () => props.onChoose() }) }]);

  return (
    <div class="choose-project">
      <Show when={!props.failure}><EmptyState art="strolling" {...{ title: copy.openAFolderToStart }} actions={[{ label: copy.chooseFolder, chord: CHORDS["project.choose-folder"], run: props.onChoose }]} /></Show>
      <Show when={props.failure}><button data-button="primary" type="button" onClick={() => props.onChoose()}>{copy.chooseFolder}</button></Show>
      <Show when={recent()?.paths.length}>
        <ul aria-label={copy.recentFolders}>
          <For each={recent()?.paths.slice(0, 5)}>{path => <li><button data-button="quiet" type="button" onClick={() => props.onOpen(path)}>{path}</button></li>}</For>
        </ul>
      </Show>
      <Show when={binary()?.value}>{value => <p>{copy.claudeBinary(value().version, value().path)}</p>}</Show>
    </div>
  );
};

export const EmptyShelf = () => (
  <>
    <EmptyState art="running" {...{ title: copy.todos }} line={copy.emptyTodosLine} />
    <EmptyState art="reading-side" {...{ title: copy.pads }} line={copy.emptyPadsLine} />
  </>
);
