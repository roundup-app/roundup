import { createSignal, onCleanup, Show } from "solid-js";
import * as v from "valibot";
import { outcomeOf } from "../app/seam";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { ReservedLine } from "../ink/ReservedLine";

/** U4547b: retain the created identity before saving or starting, so retry resumes it. */
export const CreateMode = (props: { onClose: () => void; onCreated: (id: string, request: string) => void; finalFocus: (id: string) => HTMLElement | null }) => {
  const { app, rail, drafts, project } = useConnectedProject();
  const destination = { surface: "mode-create", object: project.path, recipient: null };
  drafts.validate(destination.surface, v.strictObject({ name: v.string(), text: v.string(), id: v.nullable(v.string()), request: v.string() }));
  drafts.registerRecovery(destination.surface, () => "available");
  onCleanup(drafts.editor(destination));
  const draft = () => drafts.list().findLast(each => each.destination.surface === destination.surface);
  const value = () => ({ name: String(draft()?.value.name ?? ""), text: String(draft()?.value.text ?? ""), id: v.is(v.string(), draft()?.value.id) ? String(draft()!.value.id) : null, request: String(draft()?.value.request ?? crypto.randomUUID()) });
  const edit = (patch: { name?: string; text?: string }) => { drafts.edit(destination, { ...value(), ...patch }, null, "ordinary"); };

  const [open, setOpen] = createSignal(true);
  let created: string | null = null;
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);

  const submit = async () => {
    if (busy() || !value().name.trim() || !value().text.trim()) return;
    const revision = draft();

    if (!revision) return;
    setBusy(true);
    let submitted = revision.revision;
    const saved = value();

    try {
      if (!await drafts.submit(submitted)) return;

      if (saved.id === null) {
        saved.id = (await app.rpc("rail.createWorkstream", { name: saved.name.trim(), parent: null })).id;
        const checkpoint = drafts.edit(destination, saved, null, "ordinary", revision.revision);
        await checkpoint.retained;
        await drafts.settle(submitted, "acknowledged");
        submitted = checkpoint.draft.revision;
        await drafts.submit(submitted);
      }

      await app.rpc("workstream.setOpeningPrompt", { id: saved.id, prompt: saved.text });
      await rail.refresh();
      rail.setSectionOpen("modes", true);
      rail.select(saved.id);
      await drafts.settle(submitted, "acknowledged");
      created = saved.id;
      setOpen(false);
      props.onCreated(saved.id, saved.request);
    } catch (error) {
      await drafts.settle(submitted, outcomeOf(error));

      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    } finally { setBusy(false); }
  };

  return <Dialog.Root open={open()} finalFocusEl={() => created === null ? null : props.finalFocus(created)} onOpenChange={({ open }) => { if (!open) { setOpen(false); props.onClose(); } }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form opening-prompt-dialog">
      <Dialog.Title>{copy.newMode}</Dialog.Title>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Field.Root disabled={busy()}><Field.Label>{copy.name}</Field.Label><Field.Input type="text" value={value().name} onInput={event => edit({ name: event.currentTarget.value })} /></Field.Root>
        <Field.Root disabled={busy()} class="opening-prompt-field"><Field.Label>{copy.openingPrompt}</Field.Label><Field.Textarea value={value().text} onInput={event => edit({ text: event.currentTarget.value })} spellcheck={false} autocorrect="off" autocapitalize="off" /><Field.HelperText>{copy.modePromptHint}</Field.HelperText></Field.Root>
        <ReservedLine message={[failure(), drafts.problem() ? copy.railDraftRetention(project.name, copy.modeWord, drafts.problem()!.operation) : null].filter(Boolean).join(" ")}><Show when={drafts.problem()}><button type="button" data-button="quiet" onClick={() => void drafts.retry()}>{copy.railDraftRetry}</button></Show></ReservedLine>
        <div class="app-dialog-actions"><Dialog.CloseTrigger type="button" data-button="quiet">{copy.close}</Dialog.CloseTrigger><button type="submit" data-button="primary" aria-disabled={busy() || !value().name.trim() || !value().text.trim()}>{copy.createMode}</button></div>
      </form>
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>;
};
