import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";

/** a whole number of 1 or more, else `null`. */
const capOf = (text: string): number | null => /^\d+$/.test(text.trim()) && Number(text) >= 1 ? Number(text) : null;

/** the Project's `Workstreams at once` cap. Enter or blur with a changed value, or the `No limit` toggle, is one `project.setWorkstreamCap`; a bad entry is refused in the field and calls nothing. */
export const ProjectSettings = () => {
  const { app } = useConnectedProject();
  const [open, setOpen] = createSignal(false);
  const [saved, setSaved] = createSignal<number | null>(null);
  const [text, setText] = createSignal("1");
  const [failure, setFailure] = createSignal<string | null>(null);

  const show = async () => {
    setFailure(null);

    const message = await failureOf(async () => {
      const cap = (await app.rpc("project.get", null)).workstreamCap;

      setSaved(cap);
      setText(String(cap ?? 1));
    });

    if (message !== null) setFailure(message);

    setOpen(true);
  };

  let saving = false;

  const save = async (cap: number | null) => {
    if (saving) return;

    saving = true;
    setFailure(null);
    const message = await failureOf(() => app.rpc("project.setWorkstreamCap", { cap }));

    saving = false;

    if (message !== null) return setFailure(message);

    setSaved(cap);
    setText(String(cap ?? text()));
  };

  const commit = () => {
    if (saved() === null) return;

    const cap = capOf(text());

    if (cap === null) return setFailure(copy.capRefusal);

    if (cap !== saved()) void save(cap);
    else setFailure(null);
  };

  return <>
    <button data-button="quiet" class="word rail-import" type="button" onClick={() => void show()}>{copy.projectSettings}</button>
    <Show when={open()}>
      <Dialog.Root open onOpenChange={({ open }) => setOpen(open)}>
        <Portal><Dialog.Positioner><Dialog.Content aria-label={copy.projectSettings}>
          <Dialog.Title>{copy.projectSettings}</Dialog.Title>
          <label>
            <span>{copy.runAtMost}</span>
            <input inputMode="numeric" aria-label={copy.workstreamsAtOnce} value={text()} disabled={saved() === null}
              onInput={event => setText(event.currentTarget.value)} onBlur={commit}
              onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); } }} />
            <span>{copy.workstreamsAtOnce}</span>
          </label>
          <Checkbox checked={saved() === null} onCheckedChange={checked => void save(checked ? null : (capOf(text()) ?? 1))}>{copy.noLimit}</Checkbox>
          <Show when={failure()}>{message => <ErrorLine message={message()} />}</Show>
          <Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger>
        </Dialog.Content></Dialog.Positioner></Portal>
      </Dialog.Root>
    </Show>
  </>;
};
