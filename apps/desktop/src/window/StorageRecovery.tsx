import { createMemo, createSignal, Loading, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { deleteSavedWork, initializeStorage } from "../state/storage";
import { storageCopy } from "./copy";
import { BlockedFailure, StatusNote } from "../ink/MountedLine";
import "../state/storage.css";

/** The production startup gate never mounts editors while saved work is unavailable. */
export const StorageRecovery = (props: { children: JSX.Element }) => {
  // The signal holds the latest initialization; a retry replaces it, which shows the restoring line again.
  const [initialization, setInitialization] = createSignal(initializeStorage());
  const result = createMemo(initialization);
  const retry = () => setInitialization(initializeStorage());

  return <Loading on={initialization()} fallback={<div class="storage-failure"><StatusNote text={storageCopy.restoring} /></div>}>
    <Show when={result() === null} fallback={<div class="storage-gate"><div class="storage-gate-content">
      <BlockedFailure message={result()?.message} content={
        <Show when={result()} keyed>{failure => failure.status === "incompatible"
          ? <>{storageCopy.incompatible("")}<code class="storage-gate-folder">{failure.folder}</code></>
          : failure.message}</Show>
      } recover={result()?.status === "failed" ? { run: retry, label: storageCopy.restoreRetry } : { run: () => { deleteSavedWork(); retry(); }, label: storageCopy.deleteSaved }} /></div></div>}>
      {props.children}
    </Show>
  </Loading>;
};
