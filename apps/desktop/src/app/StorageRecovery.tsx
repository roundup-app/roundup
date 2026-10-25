import { createResource, createSignal, Show, type JSX } from "solid-js";
import { initializeStorage, storageRecovery } from "../state/storage";
import { storageCopy } from "../copy/storage";
import { ReservedLine } from "../ink/ReservedLine";
import "../state/storage.css";

/** The production startup gate never mounts editors while saved work is unavailable. */
export const StorageRecovery = (props: { children: JSX.Element }) => {
  const [result, { refetch, mutate }] = createResource(initializeStorage);
  const [pending, setPending] = createSignal(false);

  const proceed = async () => {
    const record = storageRecovery();

    if (!record || pending() || result.loading) return;
    setPending(true);

    try { mutate(await record.continue()); } finally { setPending(false); }
  };

  return <Show when={!result.loading} fallback={<div class="storage-failure"><ReservedLine status={storageCopy.restoring} /></div>}>
    <Show when={result() === null} fallback={<div class="storage-failure"><ReservedLine message={result()}>
      <button data-button="quiet" type="button" disabled={pending()} onClick={() => void refetch()}>{storageCopy.restoreRetry}</button>
      <Show when={storageRecovery()}>{record => <button data-button="quiet" type="button" disabled={pending()} onClick={() => void proceed()}>{storageCopy.continue(record().key)}</button>}</Show>
    </ReservedLine></div>}>
      {props.children}
    </Show>
  </Show>;
};
