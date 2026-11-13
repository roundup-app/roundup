import { DrawerMaximisedContext } from "../drawer/DrawerHost";
import { SegmentGroup } from "../ui/SegmentGroup";
import { appSettings } from "../settings/preferences";
import { applied } from "../app/pending";
import { historyRegion } from "../keys/focus";
import { captureFocus, keepRegionFocus } from "../keys/focus";
import { CopyButton } from "../ui/CopyButton";
import * as v from "valibot";
import { createCutTitle } from "../ui/cutTitle";
import { IconButton } from "../ui/IconButton";
import type { ActivationSource } from "../keys/registry";
import { debounce } from "@solid-primitives/scheduled";
import { copy } from "./copy";
import { Icon } from "../ink/Icon";
import { createEffect, createMemo, createSignal, lazy, on, onCleanup, Show, Suspense, useContext, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { Pad } from "@contracts/pad/Pad";
import { ItemDrawer } from "../drawer/ItemDrawer";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../app/failureOf";
import { createFailure } from "./failure";
import { outcomeOf, RpcError } from "../app/seam";
import { createDraftField } from "../state/draftField";
import { createSave, type Save } from "./padSave";
import { usePadList } from "./padList";
import type { PadList } from "./padList";
import { wholeWord } from "./nameLine";

import type { PadEditorHandle } from "./PadRichEditor";
import "./styles.css";

const PadRichEditor = lazy(() => import("./PadRichEditor"));

/** The field only keeps and sends; this surface parses its own draft. */
const stored = v.record(v.string(), v.union([v.string(), v.number(), v.boolean(), v.null(), v.array(v.string())]));

const padDraft = v.pipe(
  v.object({
    originalName: v.string(), source: v.string(), base: v.string(),
    baseRevision: v.pipe(v.number(), v.integer(), v.minValue(1)),
    editorSource: v.optional(v.string()), document: v.optional(v.string()), editorCaret: v.optional(v.boolean()),
  }),
  v.check(value => value.document === undefined
    ? value.editorSource === undefined && value.editorCaret === undefined
    : value.editorSource !== undefined && value.editorCaret !== undefined),
);

const actorOf = (save: Save) => save.kind === "conflict" ? save.actor : save.kind === "sending" ? save.over ?? null : null;

const conflictText = (actor: Actor | "unknown" | null, nameOf: (actor: Actor) => string) =>
  actor === null ? "" : actor === "unknown" ? copy.padChanged : copy.changedBy + nameOf(actor);

const restoredSave = (changed: boolean | undefined | null | "" | 0, retained: unknown): Save =>
  changed ? { kind: "conflict", actor: "unknown", version: 0 } : retained ? { kind: "paused" } : { kind: "clean" };

const PadBody = (props: {
  initialFocus: ReturnType<typeof captureFocus>;
  initial: Pad;
  revision?: string;
  list?: PadList;
  pads: Accessor<readonly Pad[]>;
  /** T27: a Todo's section link opens the Pad scrolled to this heading. */
  heading?: string | undefined;
  onLateFailure: (message: string) => void;
  onFailureCleared?: (() => void) | undefined;
  /** Successful pad.write reply for the captured original incarnation, even after closure; never an event echo or read recovery. */
  onAcknowledged?: ((incarnation: Pad["incarnation"]) => void) | undefined;
}) => {
  const connected = useConnectedProject();
  const list = props.list ?? usePadList();
  const maximised = useContext(DrawerMaximisedContext);
  const [width, setWidth] = createSignal(untrack(() => appSettings().padWidth));
  const name = props.initial.name;
  const destination = { surface: "pads", object: props.initial.incarnation, recipient: null };
  const ownDrafts = () => connected.drafts.list().filter(draft => draft.destination.surface === destination.surface && draft.destination.object === destination.object);
  const retained = ownDrafts().filter(draft => props.revision === undefined || draft.revision === props.revision).at(-1);

  const parsed = retained ? v.safeParse(padDraft, retained.value) : null;
  const field = createDraftField(connected.drafts, destination, stored);

  const draft = parsed?.success ? parsed.output : undefined;
  const recovered = draft && retained;
  const source = draft ? draft.editorSource ?? draft.source : props.initial.text;
  const base = draft ? draft.base : props.initial.text;
  let sourceRevision = draft ? draft.baseRevision : props.initial.revision;
  let originalBase = base;
  let originalRevision = sourceRevision;
  const [invalid, setInvalid] = createSignal(Boolean(parsed && !parsed.success));

  const retentionProblem = () => {
    const problem = connected.drafts.problem();

    return problem && (!problem.destination || (problem.destination.surface === destination.surface && problem.destination.object === destination.object)) ? problem : invalid() ? { cause: "invalid" } : null;
  };

  const sourceLabel = copy.copyField(copy.draftField("source").toLowerCase());

  const statusLabel = () => {
    const status = copy.draftStatus[ownDrafts().filter(draft => props.revision === undefined || draft.revision === props.revision).at(-1)?.status ?? "draft"];

    return props.revision === undefined ? copy.draftIdentity(copy.currentDraft, status) : status;
  };

  const changed = recovered && (base !== props.initial.text || sourceRevision !== props.initial.revision);
  const cycle = createSave(restoredSave(changed, retained));
  const deleted = () => cycle.save().kind === "deleted";

  const conflictActor = () => actorOf(cycle.save());

  const [pad, setPad] = createSignal(props.initial);
  const [shown, setShown] = createSignal(draft ? draft.source : source);
  const [origin, setOrigin] = createSignal(base);
  const [editing, setEditing] = createSignal(Boolean(recovered));

  createEffect(() => { if (editing()) onCleanup(connected.drafts.editor(destination)); });

  const conflictLabel = createMemo(() => conflictText(conflictActor(), connected.rail.nameOf));

  const actionFailure = createFailure();

  const note = dismissable(() => {
    const save = cycle.save();
    const problem = retentionProblem();

    if (save.kind === "deleted" && !save.byMe) return copy.padDeleted(name);
    if (problem) return copy.draftRetention(connected.project.name, copy.pad, problem.cause);

    return conflictActor() ? conflictLabel() : save.kind === "paused" ? statusLabel() : null;
  });

  let editor: PadEditorHandle | undefined;
  let pendingActor: Actor | null = null;
  let closed = false;
  let finalDraft: string | null | undefined;
  const [saved, setSaved] = createSignal(false);
  const saveAfterPause = debounce(() => flush(), 500);

  const capture = () => {
    if (closed || invalid() || (recovered && !editor)) return;
    const text = currentDraft();
    // Markdown can normalize live spaces and empty paragraphs; retain the exact native draft until acknowledgement.
    const snapshot = editor && (text === null || !editor.unchanged()) ? editor.snapshot() : null;

    if (text === null) actionFailure.show(copy.padSourceMappingFailed, "source-mapping");

    if ((text === null && !snapshot) || (!editing() && text === origin())) return;
    const selection = editor?.selection() ?? recovered?.selection ?? null;
    const source = text ?? snapshot!.text;
    const value = { originalName: name, source, base: originalBase, baseRevision: originalRevision };
    const complete = snapshot ? { ...value, editorSource: snapshot.source, document: snapshot.document, editorCaret: snapshot.trailingCaret } : value;
    field.keep(complete, selection);
  };

  /** Moves the source and its dirty/clean baseline together so a resolved change cannot remain a conflict. */
  const settle = (next: Pad) => {
    saveAfterPause.clear();
    cycle.send({ kind: "settled" });
    setSaved(false);
    setEditing(false);
    sourceRevision = next.revision;
    originalRevision = next.revision;
    originalBase = next.text;
    setOrigin(next.text);
    setShown(next.text);
    editor?.setText(next.text);
    actionFailure.clear();
  };

  /** The baseline always moves to the last loaded or saved text, even mid-edit, so a later dirty-check stays correct; the field itself only follows while the user is not typing, or their keystrokes would vanish. */
  const adopt = (next: Pad) => {
    setPad({ ...next });
    sourceRevision = next.revision;
    setOrigin(next.text);

    if (!closed && (!editing() || currentDraft() === next.text)) settle(next);
  };

  const sameContent = (left: Pad, right: Pad) =>
    left.revision === right.revision &&
    left.text === right.text;

  const currentDraft = () => finalDraft !== undefined ? finalDraft : editor ? editor.getText() : shown();

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

        const actor = pendingActor;
        pendingActor = null;

        if (!current || current.incarnation !== destination.object) {
          saveAfterPause.clear();
          cycle.send({ kind: "gone", byMe: false });
          setSaved(false);
          actionFailure.clear();
          props.onFailureCleared?.();

          return;
        }

        cycle.send({ kind: "back" });

        if (sameContent(current, pad())) return;

        setPad({ ...current });

        // Its RPC reply owns acknowledgement; an echo must not erase an undo back to the old baseline.
        const sending = cycle.save();

        if (sending.kind === "sending" && actor?.kind === "user" && current.text === sending.text) return;

        if (currentDraft() === origin()) {
          settle(current);

          return;
        }

        saveAfterPause.clear();
        setSaved(false);
        cycle.send({ kind: "external", actor: actor ?? conflictActor() ?? "unknown", version: cycle.next() });
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    // Snapshot before the lazy editor is destroyed; any queued write keeps this Pad's name and RPC connection.
    capture();
    finalDraft = currentDraft();
    closed = true;
    flush();
    const message = actionFailure.message();

    if (!deleted() && message) props.onLateFailure(message);
  });

  /** A call that fails after the Drawer closed has no ✕ line to land on, so it goes to the Shelf's. */
  const act = async (work: () => Promise<void>) => {
    const message = await failureOf(work);

    if (message === null) return;

    if (closed) props.onLateFailure(message);
    else actionFailure.show(message);
  };

  /** A refusal keeps the draft; only another edit or blur retries it. */
  const refuse = async (thrown: Error) => {
    cycle.send({ kind: outcomeOf(thrown) === "unknown" ? "unknown" : "refused" });

    if (!(thrown instanceof RpcError && thrown.code === -32003)) throw thrown;

    saveAfterPause.clear();
    cycle.send({ kind: "external", actor: "unknown", version: cycle.next() });
    await list.reload();

    const failure = list.failure();

    if (failure) throw new Error(failure);
  };

  /** `mine`: the user chose Keep mine, so the write replaces whatever the Pad now holds. */
  const write = (mine = false) =>
    act(async () => {
      const save = cycle.save();
      const resolveConflict = mine || (save.kind === "dirty" && save.due === "keep-mine");

      if (save.kind === "dirty" ? save.due === null : !(save.kind === "conflict" && mine)) return;

      const version = save.kind === "conflict" ? save.version : cycle.version();
      const expectedRevision = resolveConflict ? pad().revision : sourceRevision;
      const text = finalDraft === undefined ? currentDraft() : finalDraft;

      if (text === null) {
        cycle.send({ kind: "skipped" });
        const message = copy.padSourceMappingFailed;

        if (closed) props.onLateFailure(message);
        else actionFailure.show(message, "source-mapping");

        return;
      }

      if (text === origin() && !resolveConflict) {
        cycle.send({ kind: "skipped" });

        return;
      }

      capture();
      cycle.send({ kind: "send", text, version, mine: resolveConflict });

      if (cycle.save().kind !== "sending") return;
      setSaved(false);
      const sent = await field.send(() => applied(() => connected.app.rpc("pad.write", { name, text, expectedRevision, expectedIncarnation: destination.object })));

      if (sent.kind === "skipped") {
        cycle.send({ kind: "refused" });

        return;
      }

      if (sent.kind === "unknown") {
        cycle.send({ kind: "unknown" });
        actionFailure.show(copy.draftStatus.unknown);

        return;
      }

      if (sent.kind === "refused") return refuse(sent.error);

      const next = sent.result;
      const before = cycle.save();
      cycle.send({ kind: "applied", version });
      actionFailure.clear();
      props.onFailureCleared?.();

      // A newer explicit choice owns its baseline; an older reply cannot undo it.
      if (before.kind === "sending" && before.version === version) adopt(next);
      else if (before.kind === "conflict") {
        // An unresolved external change still needs an explicit choice.
        sourceRevision = next.revision;
        setOrigin(next.text);
      }

      const stale = cycle.save().kind === "clean" && currentDraft() !== next.text;

      setSaved(!closed && cycle.save().kind === "clean" && !stale);
      props.onAcknowledged?.(destination.object);

      // Text typed while the write was in flight goes out as the next one.
      if (stale) {
        cycle.send({ kind: "edited" });
        flush();
      }
    });

  const flush = () => {
    saveAfterPause.clear();
    cycle.send({ kind: "due", due: "autosave" });
    void write();
  };

  const exportToFile = () =>
    act(async () => {
      const path = await connected.app.chooseSavePath([name, ".md"].join(""));

      if (path !== null) await connected.app.rpc("pad.export", { name, path });
    });

  const remove = (source: ActivationSource) =>
    act(async () => {
      const focus = captureFocus();
      const close = document.activeElement?.closest(".drawer")?.querySelector<HTMLElement>(".close");
      saveAfterPause.clear();
      cycle.send({ kind: "skipped" });
      const failures = await connected.drafts.undo.removePads([{ name, incarnation: destination.object }], `pad:${destination.object}`);

      if (failures.length) throw new Error(failures[0]!.message);
      cycle.send({ kind: "gone", byMe: true });
      actionFailure.clear();
      props.onFailureCleared?.();
      await list.reload();
      // A deletion event can remove the focused Delete button before its reply closes the Drawer.
      focus(() => { if (document.activeElement === document.body) close?.focus({ preventScroll: true }); });
      connected.drawer.close(source);
      queueMicrotask(() => connected.drafts.undo.handoff(`pad:${destination.object}`, historyRegion(document.activeElement)));
      await keepRegionFocus(list.reload, ".pad-name");
    });

  const onChange = () => {
    setSaved(false);
    setEditing(true);
    cycle.send({ kind: "edited" });

    if (cycle.save().kind !== "sending" && editor?.unchanged()) {
      capture();
      settle(pad());

      return;
    }

    capture();

    if (["dirty", "sending"].includes(cycle.save().kind)) saveAfterPause();
  };

  const onText = (text: string) => {
    setShown(text);
    capture();
  };

  const onEditorBlur = (next: EventTarget | null) => {
    if (next instanceof Element && next.closest(".pad-rich-editor, [data-dismiss-failure]")) return;

    flush();
  };

  const keepMine = () => {
    if (cycle.save().kind !== "sending" && ownDrafts().some(draft => draft.status === "unknown" || draft.status === "pending")) {
      void resume();

      return;
    }

    field.save();
    saveAfterPause.clear();
    cycle.send({ kind: "due", due: "keep-mine" });
    void write(true);
  };

  const resume = () => act(async () => {
    const pending = ownDrafts().filter(draft => draft.status === "pending" || draft.status === "unknown");

    if (pending.length) {
      const current = await connected.app.rpc("pad.read", { name });

      if (current.incarnation !== destination.object) {
        cycle.send({ kind: "gone", byMe: false });

        return;
      }

      // pad.read identifies the original but cannot acknowledge a particular write.
      // Even identical current bytes could be another writer's; retain unknown snapshots.
      actionFailure.show(copy.draftStatus.unknown);

      return;
    }

    field.save();
    cycle.send({ kind: "resume" });
    flush();
  });

  const useTheirs = () => {
    void field.discard();
    setInvalid(false);
    settle(pad());
  };

  const nameCut = createCutTitle(() => name);

  return (
    <div class="pad-body" data-pad-width={maximised() ? width() : undefined} data-history-region={`pad:${destination.object}`}>
      <div class="pad-head">
        <span class="pad-head-title">
          <span {...nameCut.attrs()} class="pad-head-name">{name}</span>
        </span>
        <IconButton style={wholeWord} aria-label={copy.exportMd} onClick={() => void exportToFile()}>
          <Icon name="export" />
        </IconButton>
        <Show when={!deleted()}>
          <IconButton
            style={wholeWord}
            aria-label={copy.delete}
            disabled={connected.drafts.undo.pending() || connected.drafts.undo.uncertain()}
            onClick={() => {
              actionFailure.clear();
              void remove("key");
            }}
          >
            <Icon name="trash" />
          </IconButton>
        </Show>
      </div>
      <ReservedLine data-state={saved() && cycle.save().kind === "clean" ? "saved" : undefined} message={actionFailure.message() ?? note.message()}
        status={saved() && cycle.save().kind === "clean" ? copy.padSaved : null} dismiss={() => { if (actionFailure.message()) { actionFailure.clear(); props.onFailureCleared?.(); } else note.dismiss(); }} recover={retentionProblem() ? { run: () => connected.drafts.retry(), label: copy.storageRetry } : undefined} action={<>
        <Show when={retentionProblem()}>
          <CopyButton app={connected.app} text={invalid() ? JSON.stringify(retained?.value) : currentDraft() ?? shown()} onSuccess={() => actionFailure.clear()} onFailure={error => actionFailure.show(copy.copyDraftFailure(String(error)))}>{sourceLabel}</CopyButton>
          <button data-button="quiet" type="button" onClick={useTheirs}>{copy.discardRevision}</button>
        </Show>
        <Show when={actionFailure.kind() === "source-mapping"}>
          <CopyButton app={connected.app} text={editor?.snapshot().text ?? shown()} onSuccess={() => actionFailure.clear()} onFailure={error => actionFailure.show(copy.copyDraftFailure(String(error)))}>{copy.copyMyText}</CopyButton>
        </Show>
        <Show when={cycle.save().kind === "paused" && !retentionProblem()}><button data-button="primary" type="button" disabled={invalid()} onClick={() => void resume()}>{copy.resume}</button></Show>
        <Show when={conflictActor()}>
          <button data-button="quiet" type="button" class="word" onClick={() => keepMine()}>{copy.keepMine}</button>
          <button data-button="quiet" type="button" class="word" onClick={useTheirs}>{copy.useTheirs}</button>
        </Show>
      </>} />
      <Suspense>
        <PadRichEditor
          toolbar={<Show when={maximised()}><SegmentGroup label={copy.padWidth} segments={copy.padWidths} value={width()} onValueChange={setWidth} /></Show>}
          initialFocus={props.initialFocus}
          text={source}
          readonly={invalid()}
          onChange={onChange}
          onText={onText}
          onBlur={onEditorBlur}
          onSelection={capture}
          onReady={(ready) => {
            editor = ready;
            queueMicrotask(() => { if (props.heading !== undefined) ready.scrollToHeading(props.heading); });

            // The editor loads lazily; text adopted before it was ready must still reach it.
            if (!editing()) ready.setText(origin());

            if (draft?.document !== undefined && !ready.restoreDocument(draft.document, draft.editorCaret ?? false)) {
              setInvalid(true);
              actionFailure.show(copy.draftRetention(connected.project.name, copy.pad, "invalid"));
            }

            if (recovered?.selection) ready.restoreSelection(recovered.selection);
          }}
        />
      </Suspense>

    </div>
  );
};

/** Body of a Pad's Drawer: the Pad is read once, as the user's Touch, after the history that last-touch line shows. */
export const PadDrawer = (props: {
  name: string;
  heading?: string | undefined;
  /** Select a retained revision in this Project, using pads' already-loaded identity facts.
   * Missing revisions or originals render no editor; recovery never performs opening reads.
   */
  recovery?: { project: string; revision: string; list: PadList };
  pads: Accessor<readonly Pad[]>;
  onLateFailure: (message: string) => void;
  onFailureCleared?: (() => void) | undefined;
  /** Successful pad.write reply for the captured original incarnation, even after closure; never an event echo or read recovery. */
  onAcknowledged?: ((incarnation: Pad["incarnation"]) => void) | undefined;
}) => {
  const connected = useConnectedProject();
  const initialFocus = captureFocus();

  if (props.recovery !== undefined) {
    const recovery = props.recovery;

    if (recovery.project !== connected.project.path) return null;

    const retained = connected.drafts.list().find(draft => draft.revision === recovery.revision && draft.destination.surface === "pads" && draft.destination.recipient === null);
    const original = recovery.list.loaded() && recovery.list.failure() === null ? recovery.list.pads().find(pad => pad.name === props.name && pad.incarnation === retained?.destination.object && retained?.value.originalName === pad.name) : undefined;

    return original ? <PadBody initialFocus={initialFocus} initial={original} revision={recovery.revision} list={recovery.list} pads={recovery.list.pads} onLateFailure={props.onLateFailure} onFailureCleared={props.onFailureCleared} onAcknowledged={props.onAcknowledged} /> : null;
  }

  return (
    <ItemDrawer
      item={`pad:${props.name}`}
      read={() => connected.app.rpc("pad.read", { name: props.name })}
      sentence
      touchedBy={(event) => (event.name === "pad.changed" || event.name === "pad.deleted") && event.data.name === props.name}
    >
      {(pad) => (
        <PadBody
          initialFocus={initialFocus}
          initial={pad}
          pads={props.pads}
          heading={props.heading}
          onLateFailure={props.onLateFailure}
          onFailureCleared={props.onFailureCleared}
          onAcknowledged={props.onAcknowledged}
        />
      )}
    </ItemDrawer>
  );
};

/** The Pad's Drawer over the shared list; a late failure is the caller's to show. */
export const PadHost = (props: { name: string; heading?: string | undefined; onLateFailure?: (message: string) => void }) => (
  <PadDrawer name={props.name} heading={props.heading} pads={usePadList().pads} onLateFailure={props.onLateFailure ?? (() => {})} />
);
