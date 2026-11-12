import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js";
import * as v from "valibot";
import { outcomeOf } from "../app/seam";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { queueFocus } from "../keys/focus";
import type { RailMenuModel } from "./menu/model";
import { ReservedLine } from "../ink/ReservedLine";
import { createDraftField } from "../state/draftField";

/** A4452c: the row menu captures the Mode Agent independently of the selected Todo scope. */
export const ModePrompt = (props: { restart: () => ReturnType<RailMenuModel["restartMode"]>; id: string; onClose: () => void; finalFocus: () => HTMLElement | null }) => {
  const connected = useConnectedProject();
  const current = createMemo(() => connected.rail.nodes.find(node => node.kind === "agent" && node.parent === null && node.id === props.id));
  const [open, setOpen] = createSignal(true);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [restarting, setRestarting] = createSignal(false);
  const [restartFailed, setRestartFailed] = createSignal(false);
  const { drafts } = connected;
  const schema = v.strictObject({ text: v.string(), base: v.string() });
  drafts.validate("opening-prompt", schema);
  drafts.registerRecovery("opening-prompt", (draft, facts) => facts.rail.nodes.some(node => node.kind === "agent" && node.parent === null && node.id === draft.destination.object) ? "available" : "unavailable");
  const destination = () => ({ surface: "opening-prompt", object: props.id, recipient: null });
  const field = createDraftField(drafts, destination(), schema);
  const draft = () => drafts.list().filter(record => record.destination.surface === "opening-prompt" && record.destination.object === props.id).at(-1);
  const text = () => String(draft()?.value.text ?? current()?.mode_prompt ?? "");
  createEffect(() => {
    if (current()) onCleanup(drafts.editor(destination()));
  });

  const persist = async () => {
    const id = props.id;
    const revision = draft();

    if (!revision || revision.value.text === (current()?.mode_prompt ?? "")) return true;

    const submitted = await drafts.submit(revision.revision);

    if (!submitted) return false;

    try {
      const prompt = String(submitted.draft.value.text);

      await connected.app.rpc("agent.setModePrompt", prompt.trim() === "" ? { id } : { id, prompt });
      await connected.rail.refresh();
      await drafts.settle(revision.revision, "acknowledged");

      if (current()?.id === id) setFailure(null);

      return true;
    } catch (error) {
      await drafts.settle(revision.revision, outcomeOf(error));

      if (!(error instanceof Error)) throw error;

      if (current()?.id === id) setFailure(error.message);

      return false;
    }
  };

  let saving: Promise<boolean> | null = null;
  const save = () => saving ?? (saving = persist().finally(() => { saving = null; }));

  const restart = async () => {
    if (restarting()) return;
    setRestarting(true);

    try {
      if (!await save()) return;
      const result = await props.restart();

      if (result.kind === "pending") return;
      const failed = "message" in result;
      setRestartFailed(failed);
      setFailure(failed ? result.message : null);

      if (failed) connected.rail.commandFailure.clear();
      else {
        setOpen(false);
        props.onClose();
        queueFocus(() => props.finalFocus()?.focus({ preventScroll: true }));
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    } finally {
      setRestarting(false);
    }
  };

  return <Dialog.Root open={open()} onOpenChange={({ open }) => { if (!open) { props.onClose(); queueFocus(() => props.finalFocus()?.focus({ preventScroll: true })); } }} finalFocusEl={props.finalFocus}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form mode-prompt-dialog">
      <Dialog.Title>{copy.modePromptFor(current()?.name ?? "")}</Dialog.Title>
      <Field.Root class="mode-prompt-field">
        <Field.Textarea aria-label={copy.modePrompt} value={text()} placeholder={copy.modePromptPlaceholder} spellcheck={false} autocorrect="off" autocapitalize="off" onInput={event => {
          field.keep({ text: event.currentTarget.value, base: String(draft()?.value.base ?? current()?.mode_prompt ?? "") }, null);
        }} onBlur={() => void save()} />
        <Field.HelperText>{copy.modePromptHint}</Field.HelperText>
      </Field.Root>
      <Show when={draft() && draft()?.value.base !== (current()?.mode_prompt ?? "")}><ReservedLine status={copy.modePromptConflict} /></Show>
      <ReservedLine message={failure()} dismiss={() => setFailure(null)} recover={{ run: () => void (restartFailed() ? restart() : save()) }} />
      <div class="app-dialog-actions">
        <button data-button="quiet" class="word" type="button" disabled={restarting()} onClick={() => void restart()}>{copy.restart}</button>
        <Dialog.CloseTrigger data-button="quiet" class="word">{copy.close}</Dialog.CloseTrigger>
      </div>
  </Dialog.Content></Dialog.Positioner></Dialog.Root>;
};
