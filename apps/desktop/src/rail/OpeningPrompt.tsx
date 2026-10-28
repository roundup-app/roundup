import { createMemo, createSignal, createEffect, onCleanup } from "solid-js";
import * as v from "valibot";
import { outcomeOf } from "../app/seam";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { queueFocus } from "../keys/focus";
import { ReservedLine } from "../ink/ReservedLine";

/** A4452c: the row menu captures the Workstream independently of the selected Todo scope. */
export const OpeningPrompt = (props: { id: string; onClose: () => void; finalFocus: () => HTMLElement | null }) => {
  const connected = useConnectedProject();
  const current = createMemo(() => connected.rail.nodes.find(node => node.kind === "workstream" && node.id === props.id));
  const [failure, setFailure] = createSignal<string | null>(null);
  const { drafts } = connected;
  drafts.validate("opening-prompt", v.strictObject({ text: v.string() }));
  drafts.registerRecovery("opening-prompt", (draft, facts) => facts.rail.nodes.some(node => node.kind === "workstream" && node.id === draft.destination.object) ? "available" : "unavailable");
  const destination = () => ({ surface: "opening-prompt", object: props.id, recipient: null });
  const draft = () => drafts.list().filter(record => record.destination.surface === "opening-prompt" && record.destination.object === props.id).at(-1);
  const text = () => String(draft()?.value.text ?? current()?.opening_prompt ?? "");
  createEffect(() => {
    if (current()) onCleanup(drafts.editor(destination()));
  });

  const save = async () => {
    const id = props.id;
    const revision = draft();

    if (!revision || revision.value.text === (current()?.opening_prompt ?? "")) return;

    const submitted = await drafts.submit(revision.revision);

    if (!submitted) return;

    try {
      const prompt = String(submitted.draft.value.text);

      await connected.app.rpc("workstream.setOpeningPrompt", prompt.trim() === "" ? { id } : { id, prompt });
      await connected.rail.refresh();
      await drafts.settle(revision.revision, "acknowledged");

      if (current()?.id === id) setFailure(null);
    } catch (error) {
      await drafts.settle(revision.revision, outcomeOf(error));

      if (!(error instanceof Error)) throw error;

      if (current()?.id === id) setFailure(error.message);
    }
  };

  return <Dialog.Root open onOpenChange={({ open }) => { if (!open) { props.onClose(); queueFocus(() => props.finalFocus()?.focus({ preventScroll: true })); } }} finalFocusEl={props.finalFocus}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form opening-prompt-dialog">
      <Dialog.Title>{copy.openingPromptFor(current()?.name ?? "")}</Dialog.Title>
      <Field.Root class="opening-prompt-field">
        <Field.Textarea aria-label={copy.openingPrompt} value={text()} placeholder={copy.openingPromptPlaceholder} spellcheck={false} autocorrect="off" autocapitalize="off" onInput={event => {
          drafts.edit(destination(), { text: event.currentTarget.value }, null, "ordinary");
        }} onBlur={() => void save()} />
        <Field.HelperText>{copy.openingPromptHint}</Field.HelperText>
      </Field.Root>
      <div class="app-dialog-actions">
        <ReservedLine message={failure()}><button data-button="quiet" type="button" onClick={() => void save()}>{copy.retry}</button></ReservedLine>
        <Dialog.CloseTrigger data-button="quiet" class="word">{copy.close}</Dialog.CloseTrigger>
      </div>
  </Dialog.Content></Dialog.Positioner></Dialog.Root>;
};
