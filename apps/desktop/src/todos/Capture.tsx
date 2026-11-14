import { applied, applying } from "../app/pending";
import { currentOwner } from "../state/rail";
import { appDark } from "../settings/preferences";
import { outcomeOf } from "../app/seam";
import { queueFocus, returnFocus } from "../keys/focus";
import { writeText } from "../app/clipboard";
import { CopyButton } from "../ui/CopyButton";
import * as v from "valibot";
import { createEffect, createSignal, createUniqueId, For, on, onCleanup, onMount, untrack } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import { copy } from "./copy";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import type { Actor } from "@contracts/Actor";
import { CHORDS, LEADER } from "../keys/chords";
import { resolvedWorkstream } from "../state/railTopology";
import { captureActions, modalOpen, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { createDraftField } from "../state/draftField";
import { Dialog } from "../ui/Dialog";
import { createCutTitle } from "../ui/cutTitle";
import { USER } from "../pads/owner";
import { failureOf } from "../app/failureOf";
import { useTodoList } from "./todoList";
import { sentFailure, type Unapplied } from "./EditableText";
import "./capture.styles.css";

let optimistic = 0;

/** U3713 to U3716, U3737, U3740: `⌘K T` or `⇧⌘T` opens a one-line field. `⏎` files an Unassigned Todo and closes it, `⇧⏎` files and keeps it open, Escape cancels. The row shows before the Daemon answers; a failed create puts the text back with the cause. `open` true opens it, by the native panel when the App has one; every opening and closing goes back through `onOpenChange`. */
export const Capture = (props: { onFile: (() => void) | undefined; onNativeOpen?: (open: boolean) => void; open?: boolean; onOpenChange?: (open: boolean) => void }) => {
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

  // A draft from before the target was kept reads as one with no captured target.
  const captureSchema = v.object({
    text: v.string(), targetCaptured: v.optional(v.boolean(), false), targetOwner: v.optional(v.nullable(v.string()), null),
    targetOwnerName: v.optional(v.nullable(v.string()), null), targetHome: v.optional(v.nullable(v.string()), null), targetHomeName: v.optional(v.nullable(v.string()), null),
  });

  drafts.validate("capture", captureSchema);
  drafts.registerRecovery("capture", () => "available");
  const draft = createDraftField(drafts, destination, captureSchema);

  const records = () => drafts.list().filter(each => each.destination.surface === destination.surface
    && each.destination.object === destination.object && each.destination.recipient === null);

  /** The field's draft while it is still the user's to edit: never one sent and unanswered. */
  const current = () => {
    const latest = draft.draft();

    return latest?.status === "draft" || latest?.status === "failed" ? latest : undefined;
  };

  const kept = () => {
    const value = draft.value();

    return current() && value.success ? value.output : undefined;
  };

  const text = () => kept()?.text ?? "";

  const caretOf = () => input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;

  const setText = (text: string) => draft.keep({ text, targetCaptured: nativeSession || kept()?.targetCaptured === true, targetOwner: target().owner?.id ?? null, targetOwnerName: target().ownerName, targetHome: target().home, targetHomeName: target().homeName }, caretOf());

  const recovered = () => records().filter(each => each.revision !== current()?.revision && each.status !== "pending");

  const retainSelection = () => {
    if (current() && input) draft.select(caretOf());
  };

  createEffect(() => {
    if (open() || nativeOpen()) onCleanup(drafts.editor(destination));
  });
  /** U3746: a Todo created whose move was refused, kept with the title it was filed under so a retry of the same text moves it instead of creating another. */
  let stranded: { title: string; id: number } | null = null;
  const [failure, setFailure] = createSignal<string | null>(null);
  const problem = dismissable(() => drafts.problem() ? copy.draftRetention(connected.project.name, copy.leaderShortCapture, drafts.problem()!.cause) : null);
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
    const value = kept();

    if (text() !== "" && value?.targetCaptured) {
      const owner: Actor | null = value.targetOwner ? { kind: "agent", id: value.targetOwner, parent: null } : null;

      return { owner, ownerName: value.targetOwnerName, home: value.targetHome, homeName: value.targetHomeName };
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
    setOpen(true); props.onOpenChange?.(true);
  };

  const close = () => {
    setOpen(false);

    if (nativeOpen()) {
      setNativeOpen(false);
      props.onNativeOpen?.(false);
      void port?.dismiss().catch(error => setFailure(String(error)));
    } else returnFocus(returnTo);

    props.onOpenChange?.(false);
  };

  const discard = () => {
    if (current()) void draft.discard();

    stranded = null;
    close();
  };

  const file = async (keepOpen: boolean) => {
    const title = text().trim();
    const { owner, home } = target();

    if (title === "" || !current()) return;
    const retry = stranded?.title === title && home !== null ? stranded : null;
    let hide = () => {};

    let made = false;
    // Enter and the button are the user's Save: a recovered capture goes out only on them.
    draft.save();

    // Submitted: the row shows and the field clears before the Daemon answers.
    const submitted = () => {
      stranded = null;
      const row: Todo = { id: --optimistic, title, body: "", done: false, blockers: [], blocked: false, created_at: 0, updated_at: 0, creator: USER, home, owner, refs: [], priority: null };
      hide = todos.show(row);
      props.onFile?.();

      if (draft.draft()?.status === "pending") {
        setText("");

        if (!keepOpen) close();
      }

      return applying(async () => {
        const id = retry?.id ?? (await connected.app.rpc("todo.create", owner === null ? { title, body: null, blockers: null } : { title, body: null, blockers: null, owner })).id;
        made = retry === null;

        if (home === null) return;

        try {
          await applied(() => connected.app.rpc("todo.move", { id, home }));
        } catch (error) {
          stranded = { title, id };
          throw error;
        }
      });
    };

    const sent = await draft.send(submitted);

    if (sent.kind === "skipped") return;

    if (sent.kind === "applied") {
      await todos.reload();
      hide();

      return;
    }

    hide();

    if (made || retry || sent.kind === "unknown") void todos.reload();
    refuse(sent);
  };

  /** A capture that did not apply says why, and Capture reopens where the user typed it. */
  const refuse = (sent: Unapplied) => {
    // The empty next editor is disposable; a newer nonempty draft stays current.
    if (sent.kind === "refused" && outcomeOf(sent.error) === "failed" && text() === "" && current()) void draft.discard();
    setFailure(sentFailure(sent));

    if (port && nativeSession) { setNativeOpen(true); props.onNativeOpen?.(true); props.onOpenChange?.(true); void port.show().then(publish); }
    else show();
  };

  const publish = () => port?.publish({ session: session(), sequence: sequence(), text: text(), recovered: recovered().map(draft => ({ revision: draft.revision, text: String(draft.value.text), status: draft.status, label: copy.draftStatus[draft.status] })), owner: ownerLine(), home: homeLine(), retention: Boolean(drafts.problem()), failure: failure() ?? (drafts.problem() ? copy.draftRetention(connected.project.name, copy.leaderShortCapture, drafts.problem()!.cause) : null), mode: appDark() ? "dark" : "light" });

  const nativeShow = () => {
    if (nativeOpen() || open()) return;

    // A request the modal layer refuses is declined, so a controlled `open` does not stay true.
    if (modalOpen()) return void props.onOpenChange?.(false);

    setSession(`${identity}:${++shows}`);
    setSequence(0);
    nativeSession = true;
    capturedTarget = selectedTarget();
    setNativeOpen(true);
    props.onNativeOpen?.(true); props.onOpenChange?.(true);
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

  const recoveredAction = (kind: "copy" | "discard-revision", revision: string) => {
    const found = recovered().find(each => each.revision === revision);

    if (!found) return;

    if (kind === "discard-revision") drafts.discard(found.revision);
    else void failureOf(() => writeText(connected.app, String(found.value.text))).then(cause => setFailure(cause ? copy.copyDraftFailure(cause) : null));
  };

  if (port) {
    // U6249d F6: the seam retries a subscription, and the user cannot act on its exhaustion, so the App log holds the cause.
    onCleanup(untrack(() => port.onRequested(nativeShow)));
    onCleanup(untrack(() => port.onAction(action => {
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

      if (action.kind === "copy" || action.kind === "discard-revision") recoveredAction(action.kind, action.revision);

      if (action.kind === "file") void file(action.keepOpen);
      else if (action.kind === "discard") discard();
      else if (action.kind === "dismiss") close();
      else if (action.kind === "retry") void drafts.retry();
    })));
    createEffect(() => { if (nativeOpen()) void publish()?.catch(error => setFailure(String(error))); });
    onCleanup(() => {
      if (untrack(nativeOpen)) { void port.dismiss(); props.onNativeOpen?.(false); }
    });
  }

  registerKeys({ kind: "leader" }, [{
    action: LEADER["leader.capture"],
    capture: () => ({ available: () => !open() && connected.daemonExit() === null, invoke: show }),
  }]);
  // A request can predate the mounted dialog (a Project chosen while Capture was absent), so the effect starts after mount.
  onMount(() => createEffect(on(() => props.open, wanted => { if (wanted) (port ? nativeShow : show)(); })));
  onCleanup(() => { if (untrack(() => open() || nativeOpen())) props.onOpenChange?.(false); });
  createEffect(() => { if (props.open === undefined) registerKeys({ kind: "app" }, [{
    action: CHORDS["todo.capture"],
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
            class="capture-field field-frame"
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
          <ReservedLine message={failure() ?? problem.message()} dismiss={() => failure() ? setFailure(null) : problem.dismiss()} recover={drafts.problem() ? { run: () => drafts.retry(), label: copy.storageRetry } : undefined} />
          <For each={recovered()}>{each => <div class="capture-recovery">
            <span class="ink" data-state={each.status}>{copy.draftStatus[each.status]}</span>
            <textarea class="capture-field field-frame" aria-label={copy.recoveredCaptureDraft} rows={1} readOnly value={String(each.value.text)} />
            <div class="capture-actions">
            <CopyButton app={connected.app} identity={each.revision} text={String(each.value.text)} onSuccess={() => setFailure(null)} onFailure={error => setFailure(copy.copyDraftFailure(error.message))}>{copy.copy}</CopyButton>
            <button data-button="quiet" type="button" onClick={() => drafts.discard(each.revision)}>{copy.discardRevision}</button>
            </div>
          </div>}</For>

          <div class="capture-actions"><Dialog.CloseTrigger data-button="quiet" onClick={discard}>{copy.close}</Dialog.CloseTrigger><button type="button" data-button="primary" disabled={text().trim() === ""} onClick={() => file(false)}>{copy.captureATodo}</button></div>
        </Dialog.Content></Dialog.Positioner>
      </Dialog.Root>
  );
};
