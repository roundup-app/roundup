import { createSignal } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { failureOf } from "../app/failureOf";
import { createMessageToasts } from "../ink/messageToast";
import type { useConnectedProject } from "../state/connectedProject";
import { changedPath } from "./paths";

/** U2539d: a file that still exists opens in the editor at its line, from the checkout the comparison ends on; a failed open shows as one card. */
export const createEditor = (app: ReturnType<typeof useConnectedProject>["app"], root: () => string | undefined) => {
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());

  const clear = (key: string) => setFailures(previous => {
    const next = new Map(previous);

    next.delete(key);

    return next;
  });

  const editable = (file: ChangedFile) => file.status !== "deleted" && root() !== undefined;

  const edit = (file: ChangedFile, line = file.line) => {
    const target = changedPath(root() ?? "", file);

    void failureOf(() => app.openInEditor(target, line ?? undefined)).then(error => {
      if (error) setFailures(previous => new Map(previous).set(file.path, error));
      else clear(file.path);
    });
  };

  createMessageToasts(() => [...failures().keys()], key => ({
    get message() {
      const error = failures().get(key);

      return error === undefined ? null : `${key.split("/").pop()}: ${error}`;
    },
    dismiss: () => clear(key),
  }));

  return { editable, edit };
};
