import { createSignal, onCleanup } from "solid-js";
import * as v from "valibot";
import { applying } from "../app/pending";
import { createDraftField, type Sent } from "../state/draftField";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { dismissable, ReservedLine } from "../ink/ReservedLine";

/** U4547b: retain the created identity before saving or starting, so retry resumes it. */
export const CreateMode = (props: { onClose: () => void; onCreated: (id: string, request: string) => void; finalFocus: (id: string) => HTMLElement | null }) => {
  const { app, rail, drafts, project } = useConnectedProject();
  const destination = { surface: "mode-create", object: project.path, recipient: null };
  const schema = v.strictObject({ name: v.string(), text: v.string(), id: v.nullable(v.string()), request: v.string() });
  drafts.validate(destination.surface, schema);
  drafts.registerRecovery(destination.surface, () => "available");
  onCleanup(drafts.editor(destination));
  const field = createDraftField(drafts, destination, schema);
  const request = crypto.randomUUID();

  const value = () => {
    const stored = field.value();

    return stored.success ? stored.output : { name: "", text: "", id: null, request };
  };

  const edit = (patch: { name?: string; text?: string }) => { field.keep({ ...value(), ...patch }, null); };

  const [open, setOpen] = createSignal(true);
  let created: string | null = null;
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const line = dismissable(() => [failure(), drafts.problem() ? copy.railDraftRetention(project.name, copy.modeWord, drafts.problem()!.operation) : null].filter(Boolean).join(" "));
  const dismissLine = () => { setFailure(null); line.dismiss(); };

  /** A send that did not apply shows why; true when it applied. */
  const shown = <R,>(sent: Sent<R>): sent is Extract<Sent<R>, { kind: "applied" }> => {
    if (sent.kind === "refused") setFailure(sent.error.message);
    else if (sent.kind === "unknown") setFailure(copy.railDraftUnknown(project.name));

    return sent.kind === "applied";
  };

  const submit = async () => {
    if (busy() || !value().name.trim() || !value().text.trim()) return;
    setBusy(true);
    const saved = value();
    // U5991a: the Mode's Row shows now; the refreshed tree or a failure lifts it.
    const lift = saved.id === null ? rail.drawNew("agent", saved.name.trim(), null) : null;

    try {
      // Create is the owner's own send, so a recovered form goes too.
      field.save();
      let id = saved.id;

      if (id === null) {
        // The created id is kept as a newer revision before the first one settles, so a retry resumes it.
        const made = await field.send(() => applying(async () => {
          const createdId = (await app.rpc("agent.createMode", { name: saved.name.trim(), prompt: saved.text })).id;
          field.keep({ ...saved, id: createdId }, null);

          return createdId;
        }));

        if (!shown(made)) return;
        id = made.result;
      }

      const mode = id;

      const shownMode = await field.send(() => applying(async () => {
        await rail.refresh();
        rail.setSectionOpen("modes", true);
        rail.select(mode);
      }));

      if (!shown(shownMode)) return;
      created = mode;
      setOpen(false);
      props.onCreated(mode, saved.request);
    } finally { lift?.(); setBusy(false); }
  };

  return <Dialog.Root open={open()} finalFocusEl={() => created === null ? null : props.finalFocus(created)} onOpenChange={({ open }) => { if (!open) { setOpen(false); props.onClose(); } }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form mode-prompt-dialog">
      <Dialog.Title>{copy.newMode}</Dialog.Title>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Field.Root disabled={busy()}><Field.Label>{copy.name}</Field.Label><Field.Input type="text" value={value().name} onInput={event => edit({ name: event.currentTarget.value })} /></Field.Root>
        <Field.Root disabled={busy()} class="mode-prompt-field"><Field.Label>{copy.modePrompt}</Field.Label><Field.Textarea value={value().text} onInput={event => edit({ text: event.currentTarget.value })} spellcheck={false} autocorrect="off" autocapitalize="off" /><Field.HelperText>{copy.modePromptHint}</Field.HelperText></Field.Root>
        <ReservedLine message={line.message()} dismiss={dismissLine} recover={drafts.problem() ? { run: () => void drafts.retry(), label: copy.railDraftRetry } : undefined} />
        <div class="app-dialog-actions"><Dialog.CloseTrigger type="button" data-button="quiet">{copy.close}</Dialog.CloseTrigger><button type="submit" data-button="primary" aria-disabled={busy() || !value().name.trim() || !value().text.trim()}>{copy.createMode}</button></div>
      </form>
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>;
};
