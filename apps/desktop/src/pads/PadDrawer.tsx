import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { debounce } from "@solid-primitives/scheduled";
import { copy } from "../copy";
import { Icon } from "../ink/Icon";
import { OwnerMark } from "../ink/OwnerMark";
import { createEffect, createMemo, createSignal, lazy, on, onCleanup, Show, Suspense } from "solid-js";
import type { Accessor } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { Pad } from "@contracts/pad/Pad";
import { ItemDrawer } from "../drawer/ItemDrawer";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { createFailure } from "./failure";
import { RpcError } from "../app/seam";
import { usePadList } from "../rail/pads/padList";
import { USER } from "./owner";
import { cutName, markedLine, wholeWord } from "./nameLine";

import type { PadEditorHandle } from "./PadRichEditor";
import "./styles.css";

const PadRichEditor = lazy(() => import("./PadRichEditor"));

const PadBody = (props: {
  initial: Pad;
  pads: Accessor<readonly Pad[]>;
  onLateFailure: (message: string) => void;
}) => {
  const connected = useConnectedProject();
  const list = usePadList();
  const name = props.initial.name;
  let sourceRevision = props.initial.revision;
  let conflictVersion = 0;
  const [pad, setPad] = createSignal(props.initial);
  const [shown, setShown] = createSignal(props.initial.text);
  const [origin, setOrigin] = createSignal(props.initial.text);
  const [editing, setEditing] = createSignal(false);
  const [conflictActor, setConflictActor] = createSignal<Actor | "unknown" | null>(null);

  const conflictLabel = createMemo(() => {
    const actor = conflictActor();

    return actor === null ? "" : actor === "unknown" ? copy.padChanged : copy.changedBy + connected.rail.nameOf(actor);
  });

  const actionFailure = createFailure();
  const [deleted, setDeleted] = createSignal(false);
  const [asking, setAsking] = createSignal(false);
  const [removedByMe, setRemovedByMe] = createSignal(false);
  let deleteButton: HTMLButtonElement | undefined;
  let editor: PadEditorHandle | undefined;
  let pendingActor: Actor | null = null;
  let closed = false;
  let sent: string | null = null;
  let due: "autosave" | "keep-mine" | null = null;
  let finalDraft: string | null | undefined;
  const [saved, setSaved] = createSignal(false);
  const saveAfterPause = debounce(() => flush(), 500);

  /** Moves the source and its dirty/clean baseline together so a resolved change cannot remain a conflict. */
  const settle = (next: Pad) => {
    saveAfterPause.clear();
    due = null;
    setSaved(false);
    setEditing(false);
    sourceRevision = next.revision;
    setOrigin(next.text);
    setShown(next.text);
    editor?.setText(next.text);
    setConflictActor(null);
    actionFailure.clear();
  };

  /** The baseline always moves to the last loaded or saved text, even mid-edit, so a later dirty-check stays correct; the field itself only follows while the user is not typing, or their keystrokes would vanish. */
  const adopt = (next: Pad) => {
    setPad(next);
    sourceRevision = next.revision;
    setOrigin(next.text);

    if (!closed && (!editing() || currentDraft() === next.text)) settle(next);
  };

  const sameContent = (left: Pad, right: Pad) =>
    left.revision === right.revision &&
    left.text === right.text &&
    left.owner.kind === right.owner.kind &&
    left.owner.id === right.owner.id;

  const currentDraft = () => editor ? editor.getText() : shown();

  onCleanup(
    connected.events.subscribe((event) => {
      if (event.name === "pad.changed" && event.data.name === name) pendingActor = event.actor;
    }),
  );

  createEffect(
    on(
      props.pads,
      (listed) => {
        const current = listed.find((entry) => entry.name === name);

        setDeleted(current === undefined);

        const actor = pendingActor;
        pendingActor = null;

        if (!current) {
          saveAfterPause.clear();
          due = null;
          setSaved(false);
          setConflictActor(null);

          return;
        }

        if (sameContent(current, pad())) return;

        setPad(current);

        // Its RPC reply owns acknowledgement; an echo must not erase an undo back to the old baseline.
        if (sent !== null && actor?.kind === "user" && current.text === sent) return;

        if (currentDraft() === origin()) {
          settle(current);

          return;
        }

        if (actor && actor.kind !== "user") {
          saveAfterPause.clear();
          due = null;
          setSaved(false);
          conflictVersion += 1;
          setConflictActor(actor);
        }
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    // Snapshot before the lazy editor is destroyed; any queued write keeps this Pad's name and RPC connection.
    finalDraft = currentDraft();
    closed = true;
    flush();
  });

  /** A call that fails after the Drawer closed has no ✕ line to land on, so it goes to the Shelf's. */
  const act = (work: () => Promise<void>, failure = actionFailure) =>
    failure.run(async () => {
      try {
        await work();
      } catch (thrown) {
        if (!closed || !(thrown instanceof Error)) throw thrown;

        props.onLateFailure(thrown.message);
      }
    });

  const ownedByUser = () => pad().owner.kind === "user";

  const write = () =>
    act(async () => {
      if (sent !== null || due === null || deleted() || !ownedByUser() || (conflictActor() && due !== "keep-mine")) return;

      const resolveConflict = due === "keep-mine";
      const version = conflictVersion;
      const expectedRevision = resolveConflict ? pad().revision : sourceRevision;
      const text = finalDraft === undefined ? currentDraft() : finalDraft;
      due = null;

      if (text === null) {
        const message = copy.padSourceMappingFailed;

        if (closed) props.onLateFailure(message);
        else actionFailure.show(message);

        return;
      }

      if (text === origin() && !resolveConflict) return;

      sent = text;
      setSaved(false);

      try {
        const next = await connected.app.rpc("pad.write", { name, text, expectedRevision });

        // A newer explicit choice owns its baseline; an older reply cannot undo it.
        if (version === conflictVersion || conflictActor()) {
          // An unresolved external change still needs an explicit choice.
          if (conflictActor() && (!resolveConflict || version !== conflictVersion)) {
            sourceRevision = next.revision;
            setOrigin(next.text);
          } else adopt(next);
        }

        if (resolveConflict && version === conflictVersion) setConflictActor(null);

        setSaved(!closed && !conflictActor() && currentDraft() === next.text);
      } catch (thrown) {
        // A refusal keeps the draft; only another edit or blur retries it.
        due = null;

        if (thrown instanceof RpcError && thrown.code === -32003) {
          saveAfterPause.clear();
          conflictVersion += 1;
          setConflictActor("unknown");
          await list.reload();

          const failure = list.failure();

          if (failure) throw new Error(failure);

          return;
        }

        throw thrown;
      } finally {
        sent = null;
      }

      if (due) void write();
    });

  const flush = () => {
    saveAfterPause.clear();
    due ??= "autosave";
    void write();
  };

  /** The Agent that owns the Pad, while it is on the Rail (U432). */
  const owner = () => (pad().owner.kind === "agent" ? connected.rail.nodes.find((node) => node.id === pad().owner.id) : undefined);

  /** U432: selects the owner's row and begins a Takeover of it, Resuming it first when it has exited (A22); the Drawer stays open. */
  const openOwner = () =>
    act(async () => {
      const node = owner();

      if (!node) return;

      connected.rail.select(node.id);

      if (connected.rail.exitOf(node) !== null) {
        if (!node.can_resume) throw new Error(copy.hasExitedAndCannotBeResumed(connected.rail.nameOf(pad().owner)));

        await connected.app.rpc("agent.resume", { id: node.id });
        await connected.rail.refresh();
      }

      const failure = await connected.takeover.begin(node.id);

      if (failure !== null) throw new Error(failure);
    });

  const exportToFile = () =>
    act(async () => {
      const path = await connected.app.chooseSavePath(`${name}.md`);

      if (path !== null) await connected.app.rpc("pad.export", { name, path });
    });

  const remove = (source: ActivationSource) =>
    act(async () => {
      saveAfterPause.clear();
      due = null;
      await connected.app.rpc("pad.delete", { name });
      setDeleted(true);
      setRemovedByMe(true);
      connected.drawer.close(source);
    });

  const onChange = () => {
    setSaved(false);
    setEditing(true);

    if (due !== "keep-mine") due = null;

    if (sent === null && editor?.unchanged()) {
      settle(pad());

      return;
    }

    if (ownedByUser() && (!conflictActor() || sent !== null) && !deleted()) saveAfterPause();
  };

  const onText = (text: string) => {
    setShown(text);
  };

  const onEditorBlur = (next: EventTarget | null) => {
    if (next instanceof Element && next.closest(".pad-rich-editor")) return;

    if (ownedByUser()) flush();
  };

  /** U58: a Pad opened from under its Agent is taken here, by the owner mark, as U18's click does in the Shelf. */
  const takeIt = () =>
    act(async () => {
      adopt(await connected.app.rpc("pad.setOwner", { name, owner: USER }));
    });

  const keepMine = () => {
    saveAfterPause.clear();
    due = "keep-mine";
    void write();
  };

  const useTheirs = () => settle(pad());

  return (
    <div class="pad-body">
      <div class="pad-head">
        <Show
          when={ownedByUser()}
          fallback={
            <button data-button="icon" type="button" class="word" style={wholeWord} aria-label={copy.makeYours} onClick={() => void takeIt()}>
              <OwnerMark owner={pad().owner} decorative />
            </button>
          }
        >
          <span style={wholeWord}><OwnerMark owner={pad().owner} decorative /></span>
        </Show>
        <span class="pad-head-title">
          <span class="pad-head-name" title={name} style={cutName}>
            {name}
          </span>
          <Show when={saved() && !deleted() && !conflictActor()}>
            <span role="status" aria-live="off" data-state="saved" class="pad-saved light">{copy.padSaved}</span>
          </Show>
        </span>
        <Show when={owner()}>
          <button
            data-button="icon"
            type="button"
            class="word"
            style={wholeWord}
            aria-label={copy.openOwner}
            title={copy.ownerName(connected.rail.nameOf(pad().owner))}
            onClick={() => void openOwner()}
          >
            <Icon name="talk" />
          </button>
        </Show>
        <button data-button="icon" type="button" class="word" style={wholeWord} aria-label={copy.exportMd} title={copy.exportMd} onClick={() => void exportToFile()}>
          <Icon name="export" />
        </button>
        <Show when={!asking()}>
          <button
            data-button="icon"
            type="button"
            class="word"
            style={wholeWord}
            aria-label={copy.delete}
            title={copy.delete}
            ref={(button) => (deleteButton = button)}
            onClick={() => {
              actionFailure.clear();
              setAsking(true);
            }}
          >
            <Icon name="trash" />
          </button>
        </Show>
      </div>
      <Show when={asking()}>
        <p class="light">
          {copy.deletePad(name)}
          <Show when={pad().owner.kind !== "user"}>{copy.ownsItYouMayDeleteAnyPad(connected.rail.nameOf(pad().owner))}</Show>
          <Show when={currentDraft() !== origin()}>{copy.unsavedChangesAreLost}</Show>
          <button data-button="quiet" type="button" class="word light" onClick={(event) => void remove(activationSource(event))}>{copy.delete}</button>{" "}
          <button data-button="quiet"
            type="button"
            class="word light"
            ref={(button) => queueMicrotask(() => button.focus())}
            onClick={() => {
              setAsking(false);
              queueMicrotask(() => deleteButton?.focus());
            }}
          >{copy.keep}</button>
        </p>
      </Show>
      <Show when={actionFailure.message()}>
        {(message) => <ErrorLine message={message()} />}
      </Show>
      <Show when={deleted() && !removedByMe()}>
        <ErrorLine message={`Pad ${name} was deleted`} />
      </Show>
      <Suspense>
        <PadRichEditor
          text={props.initial.text}
          readonly={!ownedByUser()}
          onChange={onChange}
          onText={onText}
          onBlur={onEditorBlur}
          onReady={(ready) => {
            editor = ready;

            // The editor loads lazily; text adopted before it was ready must still reach it.
            if (!editing()) ready.setText(origin());
          }}
        />
      </Suspense>
      <Show when={conflictActor()}>
        <p style={{ ...markedLine, "align-items": "baseline" }}>
          <span class="light" style={wholeWord}>{conflictLabel()}</span>
          <button data-button="quiet"
            type="button"
            class="word"
            style={wholeWord}
            onClick={() => void keepMine()}
          >{copy.keepMine}</button>
          <button data-button="quiet"
            type="button"
            class="word"
            style={wholeWord}
            onClick={useTheirs}
          >{copy.useTheirs}</button>
        </p>
      </Show>
    </div>
  );
};

/** Body of a Pad's Drawer: the Pad is read once, as the user's Touch, after the history that last-touch line shows. */
export const PadDrawer = (props: {
  name: string;
  pads: Accessor<readonly Pad[]>;
  onLateFailure: (message: string) => void;
}) => {
  const connected = useConnectedProject();

  return (
    <ItemDrawer
      item={`pad:${props.name}`}
      read={() => connected.app.rpc("pad.read", { name: props.name })}
      sentence
      touchedBy={(event) => (event.name === "pad.changed" || event.name === "pad.deleted") && event.data.name === props.name}
    >
      {(pad) => (
        <PadBody
          initial={pad}
          pads={props.pads}
          onLateFailure={props.onLateFailure}
        />
      )}
    </ItemDrawer>
  );
};
