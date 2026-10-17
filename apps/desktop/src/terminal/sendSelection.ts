import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { Kind } from "@contracts/Kind";
import { copy } from "../copy";
import { doorStateOf } from "../rail/doorState";
import { railOrder } from "../switcher/entries";
import type { ConnectedProject } from "../state/connectedProject";
import type { ToastQueue } from "../toasts/queue";
import { bodyOf, NOTE_MAX } from "./excerpt";
import type { Screens } from "./screens";

/** U515: an Agent or Door B1 takes a Message for. */
type Receiver = { id: string; name: string; kind: Kind };

/**
 * U515, U516: the selection of the pane's Terminal as something to send. It holds the state of the control by the
 * selection (`open`, `note`, `error`), the running Agents, and the one `message.send` a send makes.
 */
export const createSendSelection = (connected: ConnectedProject, screens: Screens, terminalId: Accessor<string | null>, toasts: ToastQueue | undefined) => {
  const { rail, app } = connected;
  const [text, setText] = createSignal("");
  const [anchor, setAnchor] = createSignal<{ x: number; y: number } | null>(null);
  const [selecting, setSelecting] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [focusNote, setFocusNote] = createSignal(0);
  const watched = new Set<string>();

  const refresh = () => {
    const id = terminalId();
    const emulator = id === null ? null : screens.emulatorFor(id);
    const now = emulator?.selection() ?? "";

    if (now !== untrack(text)) {
      setDismissed(false);
      setError(null);
    }

    setText(now);
    setAnchor(emulator?.selectionEnd() ?? null);
  };

  createEffect(() => {
    const id = terminalId();

    untrack(() => {
      if (id !== null && !watched.has(id)) {
        watched.add(id);
        screens.emulatorFor(id).onSelection(() => {
          if (terminalId() === id) refresh();
        });
      }

      refresh();
    });
  });

  const receivers = createMemo((): Receiver[] =>
    railOrder(rail.nodes)
      .filter((node) => node.kind === "agent"
        ? node.status !== null && node.status.kind !== "done" && rail.exitOf(node) === null
        : doorStateOf(node, rail.exitOf(node), rail.doorPending(node.id), rail.doorFailure(node.id) !== null) === null && node.status?.kind !== "done")
      .map((node) => ({ id: node.id, name: node.name, kind: node.status?.kind ?? "idle" })));

  /** A selection exists, even a blank one: the control is offered and says `Nothing selected` when sent. */
  const selected = () => text() !== "";

  const send = async (to: Receiver): Promise<void> => {
    const id = terminalId();
    const body = id === null ? null : bodyOf(note(), text(), screens.emulatorFor(id).selectionFacts());

    if (body === null) {
      setError(copy.nothingSelected);

      return;
    }

    setError(null);

    try {
      await app.rpc("message.send", { to: to.id, kind: "note", body, replyTo: null });
    } catch (thrown) {
      toasts?.notify({
        key: "send-to-agent", kind: "error", name: "", line: copy.couldNotSendTo(to.name, thrown instanceof Error ? thrown.message : String(thrown)),
        selected: false, open: () => null,
      });

      return;
    }

    setNote("");
    setDismissed(true);
    toasts?.notify({
      key: "send-to-agent", kind: to.kind, name: "", line: copy.sentTo(to.name), selected: false,
      open: () => {
        if (rail.selected() !== to.id) rail.select(to.id);

        return null;
      },
    });
  };

  return {
    receivers,
    selected,
    note,
    setNote: (value: string) => setNote(value.replace(/[\r\n]+/g, " ").slice(0, NOTE_MAX)),
    error,
    anchor,
    /** The control shows by the selection once the pointer is up and the user has not sent or dismissed it. */
    open: () => selected() && !selecting() && !dismissed() && anchor() !== null,
    pointer: setSelecting,
    /** Escape in the control: it closes until the selection changes. */
    dismiss: () => setDismissed(true),
    focusNote,
    /** The context-menu item and `⇧⌘A`: the same control, with the keyboard in its note. */
    openNote: () => {
      if (!selected()) return;

      setDismissed(false);
      setFocusNote((count) => count + 1);
    },
    send,
  };
};
