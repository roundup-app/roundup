import { createResource, Show, type JSX } from "solid-js";
import { initializeStorage } from "../state/storage";
import { storageCopy } from "./copy";
import { storageCopy as savedWorkCopy } from "../state/copy";
import { ReservedLine } from "../ink/ReservedLine";
import "../state/storage.css";

/** The production startup gate never mounts editors while saved work is unavailable. */
export const StorageRecovery = (props: { children: JSX.Element }) => {
  const [result, { refetch }] = createResource(initializeStorage);

  return <Show when={!result.loading} fallback={<div class="storage-failure"><ReservedLine status={storageCopy.restoring} /></div>}>
    <Show when={result() === null} fallback={<div class="storage-gate"><div class="storage-gate-content">
      <ReservedLine message={result()?.message} content={
        <Show when={result()} keyed>{failure => failure.status === "incompatible"
          ? <>{savedWorkCopy.incompatible("")}<code class="storage-gate-folder">{failure.folder}</code></>
          : failure.message}</Show>
      } />
      <Show when={result()?.status === "failed"}><div class="storage-gate-actions">
        <button data-button="quiet" type="button" onClick={() => void refetch()}>{storageCopy.restoreRetry}</button>
      </div></Show></div></div>}>
      {props.children}
    </Show>
  </Show>;
};
