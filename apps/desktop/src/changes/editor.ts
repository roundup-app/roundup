import { createSignal } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { failureOf } from "../app/failureOf";
import { createMessageToasts } from "../ink/messageToast";
import type { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
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

      return error === undefined ? null : copy.openFailure(key.split("/").pop() ?? key, root() ?? "", error);
    },
    dismiss: () => clear(key),
  }));

  return { editable, edit };
};

/** U2539d, U7678c: Enter or a double click on a file or a hunk opens the file in the editor, at the hunk's line when it is a new one, else at the file's first change. */
export const createOpenAt = (app: Parameters<typeof createEditor>[0], root: () => string | undefined, files: () => readonly ChangedFile[]) => {
  const { editable, edit } = createEditor(app, root);

  return (path: string, at?: { side: "old" | "new"; line: number }) => {
    // A path the listing lacks is a file the diff does not touch (U7685b): it opens at the line given.
    const file = files().find(each => each.path === path) ?? { path, status: "modified" as const, line: null, counts: null, blob: null };

    if (editable(file)) edit(file, at?.side === "new" ? at.line : file.line);
  };
};
