import { captureFocus } from "../keys/focus";
import { clipboardFailure, readPaste } from "../app/clipboard";
import { copy as appCopy } from "./copy";
import type { ConnectedProject } from "../state/connectedProject";
import type { Emulator } from "./emulator";
import type { Failures } from "./failures";

export type Clipboard = {
  copy(id: string, text?: string): Promise<void>;
  paste(id: string, event: Pick<ClipboardEvent, "clipboardData">): Promise<void>;
  /** Pastes dropped paths as one shell line fragment (U162); an exited Terminal or Daemon, or no path, takes nothing. */
  pastePaths(id: string, paths: string[]): void;
  /** Routes the host's copy and paste events and keys to this Clipboard; returns the way to stop. */
  listen(id: string, host: HTMLElement): () => void;
};

type Deps = {
  connected: ConnectedProject;
  failures: Failures;
  emulatorFor: (id: string) => Emulator;
  exited: (id: string) => boolean;
  isFocused: (id: string) => boolean;
};

/** U3560b, U162: copy, paste and dropped paths of a Terminal. */
export const createClipboard = ({ connected, failures, emulatorFor, exited, isFocused }: Deps): Clipboard => {
  const { app, daemonExit } = connected;

  const copy: Clipboard["copy"] = async (id, text) => {
    const selection = text ?? emulatorFor(id).selection();

    if (!selection && text === undefined) return;

    try {
      await app.writeClipboardText(selection);
      failures.set(id, "clipboard", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      failures.set(id, "clipboard", clipboardFailure("copy", thrown));
    }
  };

  const pastePaths: Clipboard["pastePaths"] = (id, paths) => {
    if (!isFocused(id) || paths.length === 0 || exited(id) || daemonExit() !== null) return;

    emulatorFor(id).paste(`${paths.map((path) => `'${path.replaceAll("'", "'\\''")}'`).join(" ")} `);
  };

  const paste: Clipboard["paste"] = async (id, event) => {
    if (!isFocused(id) || exited(id) || daemonExit() !== null) return;

    const focus = captureFocus();
    const signal = focus.signal();

    const check = () => {
      if (signal.aborted || !isFocused(id)) throw new Error(appCopy.terminalFocusChanged);
    };

    try {
      const pasted = await readPaste(event);
      check();

      if (pasted.kind === "image") {
        const path = await app.savePastedImage(pasted.image);

        check();
        pastePaths(id, [path]);
      } else if (pasted.kind === "text" && !exited(id) && daemonExit() === null) emulatorFor(id).paste(pasted.text);

      failures.set(id, "clipboard", null);
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;

      failures.set(id, "clipboard", clipboardFailure("paste", thrown));
    } finally {
      // Release the pending focus request without moving focus after the paste settles.
      focus(() => {});
    }
  };

  const listen: Clipboard["listen"] = (id, host) => {
    const editor = (target: EventTarget | null) => target instanceof Element
      && !!target.closest('input, textarea, [contenteditable="true"]') && !target.closest(".xterm-helper-textarea");

    const onPaste = (event: ClipboardEvent) => {
      if (editor(event.target) || !isFocused(id)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void paste(id, event);
    };

    const onKey = (event: KeyboardEvent) => {
      if (editor(event.target) || !event.metaKey) return;

      if (event.key.toLowerCase() === "v" && (event.ctrlKey || event.altKey || event.shiftKey)) {
        event.preventDefault();
        event.stopImmediatePropagation();

        return;
      }

      if (event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void copy(id);
    };

    // The standard Edit > Copy reaches the webview as a `copy` event, not a key press; a key press that did arrive was consumed by onKey, so exactly one runs.
    const onCopy = (event: ClipboardEvent) => {
      if (editor(event.target) || !emulatorFor(id).selection()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void copy(id);
    };

    host.addEventListener("paste", onPaste, true);
    host.addEventListener("copy", onCopy, true);
    host.addEventListener("keydown", onKey, true);

    return () => {
      host.removeEventListener("paste", onPaste, true);
      host.removeEventListener("copy", onCopy, true);
      host.removeEventListener("keydown", onKey, true);
    };
  };

  return { copy, paste, pastePaths, listen };
};
