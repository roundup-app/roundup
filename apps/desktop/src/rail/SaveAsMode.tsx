import { createSignal } from "solid-js";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { ReservedLine } from "../ink/ReservedLine";

/** A5214b: ask for the Mode's name, then `agent.saveAsMode`; the Agent row stays as it was. */
export const SaveAsMode = (props: { id: string; onClose: () => void; finalFocus: () => HTMLElement | null }) => {
  const { app, rail } = useConnectedProject();
  const [open, setOpen] = createSignal(true);
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);

  const submit = async () => {
    if (busy() || !name().trim()) return;
    setBusy(true);

    try {
      await app.rpc("agent.saveAsMode", { id: props.id, name: name().trim() });
      await rail.refresh();
      rail.setSectionOpen("modes", true);
      setOpen(false);
      props.onClose();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    } finally { setBusy(false); }
  };

  return <Dialog.Root open={open()} finalFocusEl={props.finalFocus} onOpenChange={({ open }) => { if (!open) { setOpen(false); props.onClose(); } }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form">
      <Dialog.Title>{copy.saveAsModeTitle}</Dialog.Title>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Field.Root disabled={busy()}><Field.Label>{copy.name}</Field.Label><Field.Input type="text" value={name()} onInput={event => setName(event.currentTarget.value)} /></Field.Root>
        <ReservedLine message={failure()} />
        <div class="app-dialog-actions"><Dialog.CloseTrigger type="button" data-button="quiet">{copy.close}</Dialog.CloseTrigger><button type="submit" data-button="primary" aria-disabled={busy() || !name().trim()}>{copy.saveMode}</button></div>
      </form>
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>;
};
