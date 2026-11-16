import { createSignal, For, Show } from "solid-js";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";

/** MC73: the Add dialog: the ssh config's Hosts, each with Add, and a field for how ssh reaches another one. A failure keeps the dialog and the typed text. */
export const AddMachineDialog = (props: {
  open: boolean;
  hosts: readonly string[];
  /** Resolves with the failure's sentence, or null when the Machine was added. */
  add: (name: string) => Promise<string | null>;
  close: () => void;
  finalFocus: () => HTMLElement | null;
}) => {
  const [typed, setTyped] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);

  const submit = async (name: string) => {
    if (name.trim() === "") return;

    const failed = await props.add(name.trim());

    setFailure(failed);

    if (failed === null) {
      setTyped("");
      props.close();
    }
  };

  return <Dialog.Root open={props.open} finalFocusEl={props.finalFocus} onOpenChange={details => { if (!details.open) { setFailure(null); props.close(); } }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form add-machine">
      <Dialog.Title>{copy.addMachine}</Dialog.Title>
      <Dialog.Description>{copy.addMachineIntro}</Dialog.Description>
      <Show when={props.hosts.length > 0}>
        <section class="add-machine-hosts" aria-label={copy.sshConfigHosts}>
          <h3 class="settings-caption">{copy.sshConfigHosts}</h3>
          <ul class="settings-rows">
            <For each={props.hosts}>{host => <li class="add-machine-host">
              <span class="settings-machine-name">{host}</span>
              <button type="button" data-button="quiet" aria-label={copy.addHostLabel(host)} onClick={() => void submit(host)}>{copy.add}</button>
            </li>}</For>
          </ul>
        </section>
      </Show>
      <form class="add-machine-typed" onSubmit={event => { event.preventDefault(); void submit(typed()); }}>
        <Field.Root invalid={failure() !== null}>
          <Field.Label>{copy.typeSshTarget}</Field.Label>
          <div class="add-machine-entry">
            <Field.Input value={typed()} placeholder="user@host" spellcheck={false} autocorrect="off" autocapitalize="off" aria-label={copy.sshTargetLabel} onInput={event => setTyped(event.currentTarget.value)} />
            <button type="submit" data-button="primary">{copy.add}</button>
          </div>
          <Field.HelperText>{copy.sshTargetHint}</Field.HelperText>
        </Field.Root>
      </form>
      <ReservedLine message={failure()} dismiss={() => setFailure(null)} />
      <div class="app-dialog-actions">
        <Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger>
      </div>
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>;
};
