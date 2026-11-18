import { createSignal } from "solid-js";
import { queueFocus } from "../keys/focus";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { DialogFailure } from "../ink/MountedLine";

/** A5214b: ask for the Mode's name, then `agent.saveAsMode`; the Agent row stays as it was. */
export const SaveAsMode = (props: { id: string; onClose: () => void; finalFocus: () => HTMLElement | null }) => {
  const { app, rail } = useConnectedProject();
  const [open, setOpen] = createSignal(true);
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);

  // The Rail unmounts this Dialog at once, which ends ui-sdk's own return of focus: the row takes it back here, as the opening prompt's Dialog does.
  const close = () => {
    const row = props.finalFocus;

    setOpen(false);
    props.onClose();
    queueFocus(() => row()?.focus({ preventScroll: true }));
  };

  const submit = async () => {
    if (busy() || !name().trim()) return;
    setBusy(true);

    try {
      await app.rpc("agent.saveAsMode", { id: props.id, name: name().trim() });
      await rail.refresh();
      rail.setSectionOpen("modes", true);
      close();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    } finally { setBusy(false); }
  };

  return <Dialog.Root open={open()} onOpenChange={({ open }) => { if (!open) close(); }}>
    <Dialog.Content class="app-dialog-form">
      <Dialog.Title>{copy.saveAsModeTitle}</Dialog.Title>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Field.Root disabled={busy()}><Field.Label>{copy.name}</Field.Label><Field.Input type="text" value={name()} onInput={event => setName(event.currentTarget.value)} /></Field.Root>
        <DialogFailure message={failure()} dismiss={() => setFailure(null)} />
        <div class="app-dialog-actions"><Dialog.CloseTrigger type="button" data-button="quiet">{copy.close}</Dialog.CloseTrigger><BusyButton kind="primary" type="submit" busy={busy()} disabled={!name().trim()} busyLabel={copy.saving}>{copy.saveMode}</BusyButton></div>
      </form>
    </Dialog.Content>
  </Dialog.Root>;
};
