import { createEffect, createSignal, on, onMount, Show } from "solid-js";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { SettingsGroup, SettingsShell } from "../settings/SettingsShell";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { Checkbox } from "../ui/Checkbox";

/** a whole number of 1 or more, else `null`. */
const capOf = (text: string): number | null => /^\d+$/.test(text.trim()) && Number(text) >= 1 ? Number(text) : null;

/** The Rail's `Project settings` control (U3764): opens the centre view. */
export const ProjectSettings = () => {
  const { settingsView } = useConnectedProject();

  return <button data-button="quiet" class="word rail-import" type="button" onClick={event => settingsView.show(event.currentTarget)}>{copy.projectSettings}</button>;
};

/** U3764: the centre's Project settings view while it is open. Its Workstreams group holds the Project's `Workstreams at once` cap. */
export const ProjectSettingsView = () => {
  const { settingsView } = useConnectedProject();

  return <Show when={settingsView.open()}><ProjectSettingsBody /></Show>;
};

/** the Project's `Workstreams at once` cap. Enter or blur with a changed value, or the `No limit` toggle, is one `project.setWorkstreamCap`; a bad entry is refused in the field and calls nothing. */
const ProjectSettingsBody = () => {
  const { app, settingsView, rail } = useConnectedProject();
  const [saved, setSaved] = createSignal<number | null>(null);
  const [text, setText] = createSignal("1");
  const [failure, setFailure] = createSignal<string | null>(null);

  // Opening reads the cap; picking another row shows that row's Terminal instead.
  onMount(() => void (async () => {
    const message = await failureOf(async () => {
      const cap = (await app.rpc("project.get", null)).workstreamCap;

      setSaved(cap);
      setText(String(cap ?? 1));
    });

    if (message !== null) setFailure(message);
  })());

  createEffect(on(rail.selected, () => settingsView.close(false), { defer: true }));

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

  return <SettingsShell heading={copy.projectSettings} onClose={() => settingsView.close()}>
    <SettingsGroup name={copy.workstreams}><div class="app-dialog-form">
      <label class="app-dialog-field">
        <span>{copy.runAtMost}</span>
        <textarea rows={1} inputMode="numeric" aria-label={copy.workstreamsAtOnce} value={text()} disabled={saved() === null}
          onInput={event => setText(event.currentTarget.value)} onBlur={commit}
          onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); } }} />
        <span>{copy.workstreamsAtOnce}</span>
      </label>
      <Checkbox class="app-dialog-checkbox" checked={saved() === null} onCheckedChange={checked => void save(checked ? null : (capOf(text()) ?? 1))}>{copy.noLimit}</Checkbox>
      <ReservedLine message={failure()} />
    </div></SettingsGroup>
  </SettingsShell>;
};
