import { currentOwner } from "../state/rail";
import { appDark } from "../settings/preferences";
import { outcomeOf } from "../app/seam";
import { queueFocus } from "../keys/focus";
import { writeText } from "../app/clipboard";
import { CopyButton } from "../ui/CopyButton";
import * as v from "valibot";
import { createEffect, createSignal, createUniqueId, For, onCleanup, onMount, Show, untrack } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import type { Actor } from "@contracts/Actor";
import { CHORDS, LEADER } from "../keys/chords";
import { resolvedWorkstream } from "../rail/layout";
import { captureActions, modalOpen, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { createCutTitle } from "../ui/cutTitle";
import { USER } from "../pads/owner";
import { failureOf } from "./failureOf";
import { useTodoList } from "./todoList";
import "./capture.styles.css";

let optimistic = 0;

/** U3713 to U3716, U3737, U3740: `⌘K T` or `⇧⌘T` opens a one-line field. `⏎` files an Unassigned Todo and closes it, `⇧⏎` files and keeps it open, Escape cancels. The row shows before the Daemon answers; a failed create puts the text back with the cause. */
export const Capture = (props: { onFile: (() => void) | undefined; onNativeOpen?: (open: boolean) => void; onReady?: (show: (() => void) | undefined) => void }) => {
  const connected = useConnectedProject();
  const todos = useTodoList();
  const [open, setOpen] = createSignal(false);
  const [nativeOpen, setNativeOpen] = createSignal(false);
  const port = connected.app.capture;
  const identity = createUniqueId();
  let shows = 0;
  const [session, setSession] = createSignal(identity);
  const [sequence, setSequence] = createSignal(0);
  const { drafts } = connected;
  const destination = { surface: "capture", object: "todo-capture", recipient: null };

  const targetSchema = v.object({
    targetCaptured: v.optional(v.boolean()), targetOwner: v.optional(v.nullable(v.string())),
    targetOwnerName: v.optional(v.nullable(v.string())), targetHome: v.optional(v.nullable(v.string())), targetHomeName: v.optional(v.nullable(v.string())),
  });

  drafts.validate("capture", v.object({ text: v.string(), ...targetSchema.entries }));
  drafts.registerRecovery("capture", () => "available");

  const records = () => drafts.list().filter(draft => draft.destination.surface === destination.surface
    && draft.destination.object === destination.object && draft.destination.recipient === null);

  const current = () => {
    const latest = records().at(-1);

    return latest?.status === "draft" || latest?.status === "failed" ? latest : undefined;
  };

  const text = () => {
    const value = v.safeParse(v.string(), current()?.value.text);

    return value.success ? value.output : "";
  };

  const setText = (text: string) => drafts.edit(destination, { text, targetCaptured: nativeSession || current()?.value.targetCaptured === true, targetOwner: target().owner?.id ?? null, targetOwnerName: target().ownerName, targetHome: target().home, targetHomeName: target().homeName }, input
    ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null, "ordinary");

  const recovered = () => records().filter(draft => draft.revision !== current()?.revision && draft.status !== "pending");

  const retainSelection = () => {
    const draft = current();

    if (draft && input) drafts.setSelection(draft.revision, { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection });
  };

  createEffect(() => {
    if (open() || nativeOpen()) onCleanup(drafts.editor(destination));
  });
  /** U3746: a Todo created whose move was refused, kept with the title it was filed under so a retry of the same text moves it instead of creating another. */
  let stranded: { title: string; id: number } | null = null;
  const [failure, setFailure] = createSignal<string | null>(null);
  let returnTo: Element | null = null;
  let input: HTMLTextAreaElement | undefined;
  let panel: HTMLElement | undefined;

  /** U3740: what the selection gives a new Todo, read when the line shows and when `⏎` files, so the two agree. */
  const selectedTarget = () => {
    const nodes = connected.rail.nodes;
    const node = nodes.find(each => each.id === connected.rail.selected());
    const home = node ? resolvedWorkstream(nodes, node.id) : null;
    const homeName = home === null ? null : nodes.find(each => each.id === home)?.name ?? null;
    const owner: Actor | null = node?.kind === "agent" ? { kind: "agent", id: node.id, parent: null } : null;

    return { owner, ownerName: owner ? node!.name : null, home: homeName === null ? null : home, homeName };
  };

  let nativeSession = false;
  let capturedTarget: ReturnType<typeof selectedTarget> | undefined;

  const target = () => {
    const retained = v.safeParse(targetSchema, current()?.value);

    if (text() !== "" && retained.success && retained.output.targetCaptured) {
      const value = retained.output;
      const owner: Actor | null = value.targetOwner ? { kind: "agent", id: value.targetOwner, parent: null } : null;

      return { owner, ownerName: value.targetOwnerName ?? null, home: value.targetHome ?? null, homeName: value.targetHomeName ?? null };
    }

    return capturedTarget ?? selectedTarget();
  };

  const ownerLine = () => {
    const owner = currentOwner(connected.rail, target().owner);

    return owner ? copy.captureFor(owner.name) : copy.unassigned;
  };

  const homeLine = () => copy.captureIn(target().homeName ?? copy.projectRoot);
  const ownerCut = createCutTitle(ownerLine);
  const homeCut = createCutTitle(homeLine);

  const show = () => {
    if (open()) return;

    nativeSession = false;
    capturedTarget = undefined;
    returnTo = document.activeElement;
    setOpen(true);
  };

  const close = () => {
    setOpen(false);

    if (nativeOpen()) {
      setNativeOpen(false);
      props.onNativeOpen?.(false);
      void port?.dismiss().catch(error => setFailure(String(error)));

      return;
    }

    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };

  const discard = () => {
    const draft = current();

    if (draft) drafts.discard(draft.revision);

    stranded = null;
    close();
  };

  const file = async (keepOpen: boolean) => {
    const draft = text();
    const title = draft.trim();
    const revision = current();

    const { owner, home } = target();

    if (title === "" || !revision || !(await drafts.submit(revision.revision))) return;
    const retry = stranded?.title === title && home !== null ? stranded : null;

    stranded = null;
    const row: Todo = { id: --optimistic, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, updated_at: 0, creator: USER, home, owner, refs: [], priority: null };
    const hide = todos.show(row);

    props.onFile?.();

    if (records().at(-1)?.revision === revision.revision) {
      setText("");

      if (!keepOpen) close();
    }

    void (async () => {
      let made = false;
      let id = retry?.id ?? null;

      try {
        if (id === null) {
          const created = await connected.app.rpc("todo.create", owner === null ? { title, body: null, blockers: null } : { title, body: null, blockers: null, owner });

          id = created.id;
          made = true;
        }

        if (home !== null) {
          try {
            await connected.app.rpc("todo.move", { id, home });
          } catch (error) {
            stranded = { title, id };
            throw error;
          }
        }

        drafts.settle(revision.revision, "acknowledged");
        await todos.reload();

        hide();
      } catch (error) {
        hide();

        if (made || retry) void todos.reload();

        if (!(error instanceof Error)) throw error;
        drafts.settle(revision.revision, outcomeOf(error));

        // The empty next editor is disposable; a newer nonempty draft stays current.
        if (outcomeOf(error) === "failed" && text() === "") {
          const empty = current();

          if (empty) drafts.discard(empty.revision);
        }

        setFailure(error.message);

        if (port && nativeSession) { setNativeOpen(true); props.onNativeOpen?.(true); void port.show().then(publish); }
        else show();
      }
    })();
  };

  const publish = () => port?.publish({ session: session(), sequence: sequence(), text: text(), recovered: recovered().map(draft => ({ revision: draft.revision, text: String(draft.value.text), status: draft.status, label: copy.draftStatus[draft.status] })), owner: ownerLine(), home: homeLine(), retention: Boolean(drafts.problem()), failure: failure() ?? (drafts.problem() ? copy.draftRetention(connected.project.name, copy.leaderShortCapture, drafts.problem()!.cause) : null), mode: appDark() ? "dark" : "light" });

  const nativeShow = () => {
    if (nativeOpen() || open() || modalOpen()) return;
    setSession(`${identity}:${++shows}`);
    setSequence(0);
    nativeSession = true;
    capturedTarget = selectedTarget();
    setNativeOpen(true);
    props.onNativeOpen?.(true);
    void port?.show().then(publish).catch(error => {
      const message = `${copy.captureATodo}: ${String(error)}`;
      setFailure(message);
      // The connection outlives this Capture. Resolve App's live registration only after
      // the user returns to this Project and explicitly chooses recovery.
      connected.rail.commandFailure.show(message, null, "rail", () => {
        const action = captureActions(null).find(action => action.label === copy.captureATodo && action.value.startsWith("action:chord:"));

        if (!action?.available()) return;
        connected.rail.commandFailure.clear();
        action.run();
      });
      setNativeOpen(false);
      props.onNativeOpen?.(false);
      show();
    });
  };

  if (port) {
    let stopped = false;
    const stops: (() => void)[] = [];
    const own = (subscription: Promise<() => void>) => void subscription.then(stop => { if (stopped) stop(); else stops.push(stop); }).catch(error => setFailure(String(error)));
    own(port.onRequested(nativeShow));
    own(port.onAction(action => {
      if (!nativeOpen()) return;

      if (action.kind === "ready") {
        void publish();

        return;
      }

      if (action.session !== session()) return;

      if (action.kind === "edit" || action.kind === "file") {
        if (action.sequence < sequence()) return;
        setSequence(action.sequence);
        setText(action.text);
      }

      if (action.kind === "copy" || action.kind === "discard-revision") {
        const draft = recovered().find(draft => draft.revision === action.revision);

        if (!draft) return;

        if (action.kind === "discard-revision") drafts.discard(draft.revision);
        else void failureOf(() => writeText(connected.app, String(draft.value.text))).then(cause => setFailure(cause ? copy.copyDraftFailure(cause) : null));
      }

      if (action.kind === "file") void file(action.keepOpen);
      else if (action.kind === "discard") discard();
      else if (action.kind === "dismiss") close();
      else if (action.kind === "retry") void drafts.retry();
    }));
    createEffect(() => { if (nativeOpen()) void publish()?.catch(error => setFailure(String(error))); });
    onCleanup(() => {
      stopped = true;

      for (const stop of stops) stop();

      if (untrack(nativeOpen)) { void port.dismiss(); props.onNativeOpen?.(false); }
    });
  }

  registerKeys({ kind: "leader" }, [{
    action: LEADER.find(row => row.keys === "T")!,
    capture: () => ({ available: () => !open() && connected.daemonExit() === null, invoke: show }),
  }]);
  onMount(() => props.onReady?.(port ? nativeShow : show));
  onCleanup(() => props.onReady?.(undefined));
  createEffect(() => { if (!props.onReady) registerKeys({ kind: "app" }, [{
    action: CHORDS.find(row => row.what === copy.captureATodo)!,
    capture: () => ({ available: () => !open() && connected.daemonExit() === null, invoke: show }),
  }]); });
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [{ chords: ["Escape"], run: discard }]);

  return (
      <Dialog.Root open={open()} onOpenChange={({ open }) => { if (!open) close(); }}
        initialFocusEl={() => input ?? null}
        finalFocusEl={() => returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null}
        onEscapeKeyDown={(event) => { event.stopImmediatePropagation(); discard(); }}>
        <Dialog.Positioner><Dialog.Content class="capture" aria-label={copy.captureLabel} ref={(element) => {
          panel = element;
        }}>
          <textarea spellcheck={false} autocorrect="off" autocapitalize="off"
            class="capture-field"
            rows={1}
            wrap="off"
            aria-label={copy.captureLabel}
            placeholder={copy.capturePlaceholder}
            value={text()}
            ref={(element) => {
              input = element;
              queueFocus(() => {
                if (!element.isConnected) return;

                element.focus({ preventScroll: true });
                const caret = current()?.selection;

                if (caret) element.setSelectionRange(caret.start, caret.end, caret.direction);
              });
            }}
            onSelect={retainSelection}
            onKeyUp={retainSelection}
            onClick={retainSelection}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.isComposing) return;

              event.preventDefault();
              file(event.shiftKey);
            }}
          />
          <p class="capture-target">
            <span {...ownerCut.attrs()}>{ownerLine()}</span>
            <span {...homeCut.attrs()}>{homeLine()}</span>
          </p>
          <ReservedLine message={failure() ?? (drafts.problem() ? copy.draftRetention(connected.project.name, copy.leaderShortCapture, drafts.problem()!.cause) : null)}>
            <Show when={drafts.problem()}><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></Show>
          </ReservedLine>
          <For each={recovered()}>{draft => <div class="capture-recovery">
            <span class="ink" data-state={draft.status}>{copy.draftStatus[draft.status]}</span>
            <textarea class="capture-field" aria-label={copy.recoveredCaptureDraft} rows={1} readOnly value={String(draft.value.text)} />
            <div class="capture-actions">
            <CopyButton app={connected.app} identity={draft.revision} text={String(draft.value.text)} onSuccess={() => setFailure(null)} onFailure={error => setFailure(copy.copyDraftFailure(error.message))}>{copy.copy}</CopyButton>
            <button data-button="quiet" type="button" onClick={() => drafts.discard(draft.revision)}>{copy.discardRevision}</button>
            </div>
          </div>}</For>

          <div class="capture-actions"><Dialog.CloseTrigger data-button="quiet" onClick={discard}>{copy.cancel}</Dialog.CloseTrigger><button type="button" data-button="primary" disabled={text().trim() === ""} onClick={() => file(false)}>{copy.captureATodo}</button></div>
        </Dialog.Content></Dialog.Positioner>
      </Dialog.Root>
  );
};
