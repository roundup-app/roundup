import { createResource, Show, type JSX } from "solid-js";
import { deleteSavedWork, initializeStorage } from "../state/storage";
import { storageCopy } from "../app/copy";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import "../state/storage.css";

/** The production startup gate never mounts editors while saved work is unavailable. */
export const StorageRecovery = (props: { children: JSX.Element }) => {
  const [result, { refetch }] = createResource(initializeStorage);
  const line = dismissable(() => result()?.message);

  return <Show when={!result.loading} fallback={<div class="storage-failure"><ReservedLine status={storageCopy.restoring} /></div>}>
    <Show when={result() === null} fallback={<div class="storage-gate"><div class="storage-gate-content">
      <ReservedLine message={line.message()} content={
        <Show when={result()} keyed>{failure => failure.status === "incompatible"
          ? <>{storageCopy.incompatible("")}<code class="storage-gate-folder">{failure.folder}</code></>
          : failure.message}</Show>
      } blocked recover={result()?.status === "failed" ? { run: () => void refetch(), label: storageCopy.restoreRetry } : { run: () => { deleteSavedWork(); void refetch(); }, label: storageCopy.deleteSaved }} /></div></div>}>
      {props.children}
    </Show>
  </Show>;
};
