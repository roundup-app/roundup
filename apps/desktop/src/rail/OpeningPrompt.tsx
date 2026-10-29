import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js";
import * as v from "valibot";
import { outcomeOf } from "../app/seam";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { queueFocus } from "../keys/focus";
import type { RailMenuModel } from "./menu/model";
import { ReservedLine } from "../ink/ReservedLine";

/** A4452c: the row menu captures the Workstream independently of the selected Todo scope. */
export const OpeningPrompt = (props: { restart: () => ReturnType<RailMenuModel["restartSession"]>; id: string; onClose: () => void; finalFocus: () => HTMLElement | null }) => {
  const connected = useConnectedProject();
  const current = createMemo(() => connected.rail.nodes.find(node => node.kind === "workstream" && node.id === props.id));
  const [failure, setFailure] = createSignal<string | null>(null);
  const [restarting, setRestarting] = createSignal(false);
  const [restartFailed, setRestartFailed] = createSignal(false);
  const { drafts } = connected;
  drafts.validate("opening-prompt", v.strictObject({ text: v.string(), base: v.optional(v.string()) }));
  drafts.registerRecovery("opening-prompt", (draft, facts) => facts.rail.nodes.some(node => node.kind === "workstream" && node.id === draft.destination.object) ? "available" : "unavailable");
  const destination = () => ({ surface: "opening-prompt", object: props.id, recipient: null });
  const draft = () => drafts.list().filter(record => record.destination.surface === "opening-prompt" && record.destination.object === props.id).at(-1);
  const text = () => String(draft()?.value.text ?? current()?.opening_prompt ?? "");
  createEffect(() => {
    if (current()) onCleanup(drafts.editor(destination()));
  });

  const persist = async () => {
    const id = props.id;
    const revision = draft();

    if (!revision || revision.value.text === (current()?.opening_prompt ?? "")) return true;

    const submitted = await drafts.submit(revision.revision);

    if (!submitted) return false;

    try {
      const prompt = String(submitted.draft.value.text);

      await connected.app.rpc("workstream.setOpeningPrompt", prompt.trim() === "" ? { id } : { id, prompt });
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

  return <Dialog.Root open onOpenChange={({ open }) => { if (!open) { props.onClose(); queueFocus(() => props.finalFocus()?.focus({ preventScroll: true })); } }} finalFocusEl={props.finalFocus}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form opening-prompt-dialog">
      <Dialog.Title>{copy.openingPromptFor(current()?.name ?? "")}</Dialog.Title>
      <Field.Root class="opening-prompt-field">
        <Field.Textarea aria-label={copy.openingPrompt} value={text()} placeholder={copy.openingPromptPlaceholder} spellcheck={false} autocorrect="off" autocapitalize="off" onInput={event => {
          drafts.edit(destination(), { text: event.currentTarget.value, base: draft()?.value.base ?? current()?.opening_prompt ?? "" }, null, "ordinary");
        }} onBlur={() => void save()} />
        <Field.HelperText>{copy.openingPromptHint}</Field.HelperText>
      </Field.Root>
      <Show when={draft()?.value.base !== undefined && draft()?.value.base !== (current()?.opening_prompt ?? "")}><ReservedLine status={copy.openingPromptConflict} /></Show>
      <ReservedLine message={failure()}><button data-button="quiet" type="button" onClick={() => void (restartFailed() ? restart() : save())}>{copy.retry}</button></ReservedLine>
      <div class="app-dialog-actions">
        <button data-button="quiet" class="word" type="button" disabled={restarting()} onClick={() => void restart()}>{copy.restartSession}</button>
        <Dialog.CloseTrigger data-button="quiet" class="word">{copy.close}</Dialog.CloseTrigger>
      </div>
  </Dialog.Content></Dialog.Positioner></Dialog.Root>;
};
