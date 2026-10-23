import { writeText } from "../app/clipboard";
import * as v from "valibot";
import { INTERNAL_CODE, RpcError } from "../app/seam";
import { batch, createEffect, createRenderEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { Kind } from "@contracts/Kind";
import { copy } from "../copy";
import { doorStateOf } from "../rail/doorState";
import { railOrder } from "../rail/layout";
import type { ConnectedProject } from "../state/connectedProject";
import type { ToastQueue } from "../toasts/queue";
import { bodyOf, NOTE_MAX } from "./excerpt";
import type { Screens } from "./screens";
import type { TurnFacts } from "./turns";

const availability = { available: "available", unavailable: "unavailable", unverified: "unverified" } as const;

const form = v.strictObject({
  note: v.string(), excerpt: v.string(), source: v.string(), terminal: v.string(),
  attempt: v.nullable(v.string()), command: v.nullable(v.string()), cwd: v.nullable(v.string()),
  exit: v.union([v.number(), v.literal("running"), v.null()]),
  x: v.number(), y: v.number(),
});

/** U515: an Agent or Door B1 takes a Message for. */
type Receiver = { id: string; name: string; kind: Kind };

/**
 * U515, U516: the selection of the pane's Terminal as something to send. It holds the state of the control by the
 * selection (`open`, `note`, `error`), the running Agents, and the one `message.send` a send makes.
 */
export const createSendSelection = (connected: ConnectedProject, screens: Screens, terminalId: Accessor<string | null>, toasts: ToastQueue | undefined) => {
  const { rail, app } = connected;
  const [text, setText] = createSignal("");
  const [held, setHeld] = createSignal<{ text: string; facts: TurnFacts | null; anchor: { x: number; y: number } | null } | null>(null);
  const [anchor, setAnchor] = createSignal<{ x: number; y: number } | null>(null);
  const [selecting, setSelecting] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [focusNote, setFocusNote] = createSignal(0);
  const watched = new Set<string>();
  const { drafts } = connected;
  drafts.validate("terminal_selection", form);
  drafts.registerRecovery("terminal_selection", (draft, facts) => {
    const parsed = v.safeParse(form, draft.value);

    if (!parsed.success) return availability.unverified;
    const value = parsed.output;

    if (facts.daemonExit() || facts.rail.terminalExit(value.terminal)) return availability.unavailable;

    if (facts.rail.failure()) return availability.unverified;

    if (draft.destination.recipient !== null && !facts.rail.nodes.some((node) => node.id === draft.destination.recipient)) return availability.unavailable;
    const source = facts.rail.nodes.find((node) => node.id === value.source);
    const terminal = facts.rail.terminals().find((each) => each.id === value.terminal);

    return source?.attempt === value.attempt && source?.terminal_id === value.terminal && terminal?.running
      ? "available" : "unavailable";
  });
  const [revision, setRevision] = createSignal<string | null>(null);
  const current = createMemo(() => drafts.list().find((draft) => draft.revision === revision()));
  const [caret, setCaret] = createSignal<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);

  const retain = (recipient = current()?.destination.recipient ?? (receivers().length === 1 ? receivers()[0]!.id : null), submitting = false) => batch(() => {
    if (!note() && !current() && !submitting) return null;
    const id = terminalId();
    const source = rail.nodes.find((node) => node.terminal_id === id);
    const capture = held();
    const at = capture?.anchor ?? anchor();

    const previous = current();
    const parsed = v.safeParse(form, previous?.value);
    const original = parsed.success ? parsed.output : null;

    if (!id || !at || !selected() || (!original && !source)) return null;
    const facts = capture ? capture.facts : screens.emulatorFor(id).selectionFacts();

    const saved = drafts.edit({ surface: "terminal_selection", object: previous?.destination.object ?? crypto.randomUUID(), recipient }, {
      note: note(), excerpt: capture?.text ?? text(), source: original?.source ?? source!.id, terminal: original?.terminal ?? id, attempt: original ? original.attempt : source!.attempt,
      command: facts?.command ?? null, cwd: facts?.cwd ?? null, exit: facts?.exit ?? null, x: at.x, y: at.y,
    }, caret(), "ordinary");

    setRevision(saved.draft.revision);

    if (!held()) setHeld({ text: text(), facts, anchor: at });

    return saved.draft;
  });

  const restore = () => {
    const id = terminalId();

    const saved = drafts.list().filter((draft) => draft.destination.surface === "terminal_selection"
      && draft.value.terminal === id).at(-1);

    setRevision(null);
    setNote("");
    setCaret(null);
    setHeld(null);

    if (!saved || drafts.availability(saved, connected) !== "available") return;
    const parsed = v.safeParse(form, saved.value);

    if (!parsed.success) return;
    const value = parsed.output;
    setRevision(saved.revision);
    setNote(value.note);
    setCaret(saved.selection);
    setHeld({ text: value.excerpt, facts: { command: value.command, cwd: value.cwd, exit: value.exit }, anchor: { x: value.x, y: value.y } });
    setDismissed(false);
  };

  const refresh = () => {
    const id = terminalId();
    const emulator = id === null ? null : screens.emulatorFor(id);
    const now = emulator?.selection() ?? "";

    if (now !== "" && now !== untrack(text)) {
      setRevision(null);
      setNote("");
      setCaret(null);
      setHeld(null);
      setDismissed(false);
      setError(null);
    }

    setText(now);
    setAnchor(emulator?.selectionEnd() ?? null);
  };

  createRenderEffect(() => {
    const id = terminalId();

    untrack(() => {
      setHeld(null);

      if (id !== null && !watched.has(id)) {
        watched.add(id);
        screens.emulatorFor(id).onSelection(() => {
          if (terminalId() === id) refresh();
        });
      }

      refresh();
      restore();
    });
  });

  const receivers = createMemo((): Receiver[] =>
    railOrder(rail.nodes)
      .filter((node) => !current()?.destination.recipient || node.id === current()?.destination.recipient)
      .filter((node) => node.kind === "agent"
        ? node.status !== null && node.status.kind !== "done" && rail.exitOf(node) === null
        : doorStateOf(node, rail.exitOf(node), rail.doorPending(node.id), rail.doorFailure(node.id) !== null) === null && node.status?.kind !== "done")
      .map((node) => ({ id: node.id, name: node.name, kind: node.status?.kind ?? "idle" })));

  /** A selection exists, even a blank one: the control is offered and says `Nothing selected` when sent. */
  const selected = () => (held()?.text ?? text()) !== "";
  const shown = () => selected() && !selecting() && !dismissed() && (held()?.anchor ?? anchor()) !== null;

  // The note is being typed while its popover shows; leaving it is what makes unsent text unfinished work (U3289a).
  const noteObject = createMemo(() => current()?.destination.object);
  createEffect(() => {
    const object = noteObject();

    if (object !== undefined && shown()) onCleanup(drafts.editor({ surface: "terminal_selection", object, recipient: current()?.destination.recipient ?? null }));
  });

  const send = async (to: Receiver): Promise<boolean> => {
    const id = terminalId();
    const capture = held();
    const body = id === null ? null : bodyOf(note(), capture?.text ?? text(), capture ? capture.facts : screens.emulatorFor(id).selectionFacts());

    if (body === null) {
      setError(copy.nothingSelected);

      return false;
    }

    const existing = current();

    if (existing?.destination.recipient && existing.destination.recipient !== to.id) {
      setError(copy.originalUnavailable);

      return false;
    }

    if (existing && (existing.status === "pending" || existing.status === "unknown")) {
      setError(copy.draftStatus[existing.status]);

      return false;
    }

    const saved = existing?.destination.recipient === to.id ? existing : retain(to.id, true);

    if (!saved || drafts.availability(saved, connected) !== "available") {
      setError(copy.originalUnavailable);

      return false;
    }

    drafts.submit(saved.revision);
    setError(null);

    try {
      await app.rpc("message.send", { to: to.id, kind: "note", body, replyTo: null });
    } catch (thrown) {
      const outcome = connected.daemonExit() || (thrown instanceof RpcError && thrown.code === INTERNAL_CODE) ? "unknown" : "failed";
      const reason = thrown instanceof Error ? thrown.message : String(thrown);

      drafts.settle(saved.revision, outcome);
      toasts?.notify({
        key: "send-to-agent", kind: "error", name: "", line: outcome === "unknown" ? copy.draftIdentity(copy.draftStatus.unknown, to.name, reason) : copy.couldNotSendTo(to.name, reason),
        selected: false, open: () => null,
      });

      return false;
    }

    const consumed = revision() === saved.revision && terminalId() === id;

    drafts.settle(saved.revision, "acknowledged");

    if (consumed) {
      setRevision(null);
      setNote("");
      setCaret(null);
      setHeld(null);
      setDismissed(true);
    }

    toasts?.notify({
      key: "send-to-agent", kind: to.kind, name: "", line: copy.sentTo(to.name), selected: false,
      open: () => {
        if (rail.selected() !== to.id) rail.select(to.id);

        return null;
      },
    });

    return consumed;
  };

  // An acknowledgement/discard can arrive through an earlier editor or Project recovery.
  createEffect(() => {
    if (!revision() || current()) return;

    untrack(() => {
      setRevision(null);
      setNote("");
      setCaret(null);
      setHeld(null);
      setDismissed(true);
    });
  });

  const hold = () => {
    const id = terminalId();

    if (id !== null && !held() && text() !== "") setHeld({ text: text(), facts: screens.emulatorFor(id).selectionFacts(), anchor: anchor() });

    if (!current()) retain();
  };

  return {
    receivers,
    selected,
    note,
    setNote: (value: string) => {
      setNote(value.replace(/[\r\n]+/g, " ").slice(0, NOTE_MAX));
      retain();
    },
    caret,
    hasDraft: () => !!current() || note().length > 0,
    selection: (start: number, end: number, direction: "forward" | "backward" | "none") => {
      const before = caret();

      if (before?.start === start && before.end === end && before.direction === direction) return;
      setCaret({ start, end, direction });

      if (current()?.status === "draft") retain();
    },
    discard: () => {
      const selected = revision();

      if (selected) drafts.discard(selected);
      restore();

      if (!revision()) setDismissed(true);
    },
    problem: () => {
      const failure = drafts.problem();

      if (!failure || (failure.destination && failure.destination.surface !== "terminal_selection")) return null;

      return copy.selectionRetentionFailure(connected.project.name);
    },
    retry: () => drafts.retry(),
    copy: async (field: "note" | "excerpt") => {
      try {
        await writeText(app, field === "note" ? note() : held()?.text ?? text());
        setError(null);
      }
      catch (thrown) { setError(copy.copyDraftFailure(thrown instanceof Error ? thrown.message : String(thrown))); }
    },
    error,
    anchor: () => held()?.anchor ?? anchor(),
    hold,
    /** The control shows by the selection once the pointer is up and the user has not sent or dismissed it. */
    open: shown,
    pointer: setSelecting,
    /** Escape in the control: it closes until the selection changes. */
    dismiss: () => { if (!current()) retain(); setDismissed(true); },
    focusNote,
    /** The context-menu item and `⇧⌘A`: the same control, with the keyboard in its note. */
    openNote: () => {
      if (!selected()) return;

      hold();
      setDismissed(false);
      setFocusNote((count) => count + 1);
    },
    send,
  };
};
