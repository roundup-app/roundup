import "./FirstRun.css";
import { createResource, For, Show } from "solid-js";
import { Icon } from "../ink/Icon";
import { EmptyState } from "../ink/EmptyState";
import type { App } from "./seam";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";

/** Screen 11 of `docs/wireframes.md`: each region says what will live there; there is no tutorial. */
export const EmptyRail = () => (
  <EmptyState icon="folder" heading={copy.agentsAndTerminals} hint={<>{copy.appearHereOnePerRow}<br />{copy.nestedByIndent}</>} />
);

export const ChooseProject = (props: { app: App; failure: string | null; onOpen: (path: string) => void; onChoose: () => void; onRetry?: (() => void) | undefined }) => {
  const [recent] = createResource(() => props.app.recentProjects().then(paths => ({ paths, failure: null })).catch((error: Error) => ({ paths: [], failure: error.message })));
  const [binary] = createResource(() => props.app.claudeBinary().then(value => ({ value, failure: null })).catch((error: Error) => ({ value: null, failure: error.message })));

  return (
    <div class="choose-project">
      <ReservedLine message={props.failure} status={copy.openAFolderToStart}><Show when={props.onRetry}>{retry => <button data-button="quiet" type="button" onClick={retry()}>{copy.retry}</button>}</Show></ReservedLine>
      <Show when={recent()?.failure}>{failure => <ReservedLine message={failure()} />}</Show>
      <Show when={recent()?.paths.length}>
        <ul aria-label={copy.recentFolders}>
          <For each={recent()?.paths}>{path => <li><button data-button="quiet" type="button" onClick={() => props.onOpen(path)}>{path}</button></li>}</For>
        </ul>
      </Show>
      <button data-button="quiet" type="button" class="word" onClick={() => props.onChoose()}>{copy.chooseFolder}</button>
      <Show when={binary()}>{fact => <Show when={fact().value} fallback={<ReservedLine message={fact().failure ?? copy.claudeNotFound} />}>{value => <p>{copy.claudeBinary(value().version, value().path)}</p>}</Show>}</Show>
    </div>
  );
};

export const EmptyShelf = () => (
  <>
    <EmptyState icon="check" heading={copy.todos} hint={<>{copy.agentsAddThemAsThey}<br />{copy.planSoCanYou}</>} />
    <EmptyState icon="diamond" heading={copy.pads} hint={<><Icon name="owned" />{copy.agentNotes}<br /><Icon name="diamond" />{copy.yours}</>} />
  </>
);
