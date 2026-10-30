import * as v from "valibot";
import { batch, createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { Deferred } from "../ui/Deferred";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { SettingsGroup, SettingsShell } from "../settings/SettingsShell";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { Checkbox } from "../ui/Checkbox";

/** a whole number of 1 or more, else `null`. */
const capOf = (text: string): number | null => /^\d+$/.test(text.trim()) && Number(text) >= 1 ? Number(text) : null;

/** U3813/U3814: native Project commands share one persistent center-page owner. */
export const ProjectSettingsView = () => {
  const { app, project, settingsView, importing, rail } = useConnectedProject();
  let disposed = false;
  let stop: (() => void) | undefined;
  void app.onProjectPage(({ path, command }) => {
    if (path !== project.path || (command !== "import-work" && command !== "project-settings")) return;
    const selected = rail.selected();
    batch(() => {
      settingsView.show(document.activeElement instanceof HTMLElement ? document.activeElement : document.body, command, () => rail.select(selected));

      if (command === "import-work" && !importing.open()) importing.show();
    });
  }).then(release => { if (disposed) release(); else stop = release; });
  onCleanup(() => { disposed = true; stop?.(); });
  createEffect(on(importing.open, open => {
    if (open && !settingsView.open()) settingsView.show(document.body, "import-work");

    if (!open && settingsView.open() && settingsView.page() === "import-work") settingsView.close(false);
  }));

  const close = () => batch(() => { importing.cancel(); settingsView.close(); });
  const closeImport = () => { if (!importing.pending()) close(); };

  return <>
    <Show when={settingsView.open() && settingsView.page() === "project-settings"}><ProjectSettingsBody onClose={close} /></Show>
    <Show when={settingsView.open() && settingsView.page() === "import-work" && importing.open()}><Deferred load={() => import("../importer/ImportPanel")} label={copy.importTitle} onClose={closeImport}>{module => <module.ImportPanel onClose={closeImport} />}</Deferred></Show>
  </>;
};

/** the Project's `Workstreams at once` cap. Enter or blur with a changed value, or the `No limit` toggle, is one `project.setWorkstreamCap`; a bad entry is refused in the field and calls nothing. */
const ProjectSettingsBody = (props: { onClose: () => void }) => {
  const { app, drafts } = useConnectedProject();
  drafts.validate("settings", v.object({ text: v.string() }));
  const destination = { surface: "settings", object: "workstreamCap", recipient: null };
  const draft = () => drafts.list().findLast(entry => entry.destination.surface === "settings" && entry.destination.object === "workstreamCap");
  const release = drafts.editor(destination);
  onCleanup(release);
  const [saved, setSaved] = createSignal<number | null>(null);
  const [text, setText] = createSignal("1");
  const [failure, setFailure] = createSignal<string | null>(null);

  // Each opening reads the current cap.
  onMount(() => void (async () => {
    const message = await failureOf(async () => {
      const cap = (await app.rpc("project.get", null)).workstreamCap;

      setSaved(cap);
      setText(String(draft()?.value.text ?? cap ?? 1));
    });

    if (message !== null) setFailure(message);
  })());

  let saving = false;

  const save = async (cap: number | null) => {
    if (saving) return;

    saving = true;
    setFailure(null);
    const revision = draft()?.revision;
    const message = await failureOf(() => app.rpc("project.setWorkstreamCap", { cap }));

    saving = false;

    if (message !== null) return setFailure(message);

    const current = draft()?.revision;

    if (revision) drafts.discard(revision);
    setSaved(cap);

    if (current === revision) setText(String(cap ?? text()));
  };

  const commit = () => {
    if (saved() === null) return;

    const cap = capOf(text());

    if (cap === null) return setFailure(copy.capRefusal);

    if (cap !== saved()) void save(cap);
    else setFailure(null);
  };

  return <SettingsShell heading={copy.projectSettings} onClose={props.onClose}>
    <SettingsGroup name={copy.workstreams}><div class="app-dialog-form">
      <label class="app-dialog-field">
        <span>{copy.runAtMost}</span>
        <textarea rows={1} inputMode="numeric" aria-label={copy.workstreamsAtOnce} value={text()} disabled={saved() === null}
          onInput={event => {
            const field = event.currentTarget;
            setText(field.value);
            drafts.edit(destination, { text: field.value }, { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection }, "ordinary");
          }} onBlur={commit}
          onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); } }} />
        <span>{copy.workstreamsAtOnce}</span>
      </label>
      <Checkbox class="app-dialog-checkbox" checked={saved() === null} onCheckedChange={checked => void save(checked ? null : (capOf(text()) ?? 1))}>{copy.noLimit}</Checkbox>
      <ReservedLine message={failure()} />
      <ReservedLine message={drafts.problem() ? copy.draftRetention(copy.projectSettings, copy.workstreams, drafts.problem()!.cause) : null}><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></ReservedLine>
    </div></SettingsGroup>
  </SettingsShell>;
};
