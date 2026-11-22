import * as v from "valibot";
import { Show, createSignal, onSettled } from "solid-js";
import { copy } from "./copy";
import { dismissable } from "../ink/recovery";
import { createMessageToast } from "../ink/messageToast";
import { SettingsGroup } from "./SettingsShell";
import { markControl } from "./place";
import { ConnectedProjectContext, useConnectedProject, type ConnectedProject } from "../state/connectedProject";
import { failureOf } from "../app/failureOf";
import { Tabs } from "../ui/Tabs";
import { Checkbox } from "../ui/Checkbox";
import { ProgramSettings } from "./ProgramSettings";

/** a whole number of 1 or more, else `null`. */
const capOf = (text: string): number | null => /^\d+$/.test(text.trim()) && Number(text) >= 1 ? Number(text) : null;

/** U7887a: the Project page of Settings, for the connection it sits in: the `Workstreams at once` cap, then the Program.
 * The cap: Enter or blur with a changed value, or the `No limit` toggle, is one `project.setWorkstreamCap`; a bad entry is refused in the field and calls nothing. */
export const ProjectPage = () => {
  const { app, drafts } = useConnectedProject();
  drafts.validate("settings", v.object({ text: v.string() }));
  const destination = { surface: "settings", object: "workstreamCap", recipient: null };
  const draft = () => drafts.list().findLast(entry => entry.destination.surface === "settings" && entry.destination.object === "workstreamCap");
  onSettled(() => drafts.editor(destination));
  const [saved, setSaved] = createSignal<number | null>(null);
  const [text, setText] = createSignal("1");
  const [failure, setFailure] = createSignal<string | null>(null);

  // Each opening reads the current cap.
  onSettled(() => void (async () => {
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

  const draftLine = dismissable(() => {
    const problem = drafts.problem();

    return problem ? copy.draftRetention(copy.settingsProject, copy.workstreams, problem.cause) : null;
  });

  createMessageToast({ get message() { return failure(); }, dismiss: () => setFailure(null) });
  createMessageToast({ get message() { return draftLine.message(); }, dismiss: draftLine.dismiss, recover: { run: () => drafts.retry(), label: copy.storageRetry } });

  return <>
    <SettingsGroup name={copy.workstreams}><div class="app-dialog-form">
      {markControl("workstreams", () => <label class="app-dialog-field">
        <span>{copy.runAtMost}</span>
        <textarea class="field-frame" rows={1} inputmode="numeric" aria-label={copy.workstreamsAtOnce} value={text()} disabled={saved() === null}
          onInput={event => {
            const field = event.currentTarget;
            setText(field.value);
            drafts.edit(destination, { text: field.value }, { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection }, "ordinary");
          }} onBlur={commit}
          onKeyDown={event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commit(); } }} />
        <span>{copy.workstreamsAtOnce}</span>
      </label>)}
      <Checkbox class="app-dialog-checkbox" checked={saved() === null} onCheckedChange={checked => void save(checked ? null : (capOf(text()) ?? 1))}>{copy.noLimit}</Checkbox>
    </div></SettingsGroup>
    <ProgramSettings />
  </>;
};

/** U7887c: the Project page's content, for the Project the page is about. */
export const ProjectContent = (props: { connection: ConnectedProject | undefined }) => (
  <Show when={props.connection} keyed>{open => <ConnectedProjectContext value={open}><ProjectPage /></ConnectedProjectContext>}</Show>
);

/** U7887c: the Project page's tab and its content, offered while a Project is viewed. */
export const ProjectTab = (props: { viewed: string | null }) => (
  <Show when={props.viewed}>
    <div class="settings-category" aria-hidden="true">{copy.settingsProject}</div>
    <Tabs.Trigger value={copy.settingsProject}>{copy.settingsProject}</Tabs.Trigger>
  </Show>
);
