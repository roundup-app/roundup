import { createResource, createSignal, Show } from "solid-js";
import * as v from "valibot";
import type { App } from "../app/seam";
import { copy } from "../copy";
import { draftStorage } from "../state/storage";
import { Field } from "../ui/Field";
import { Switch } from "../ui/Switch";
import { ReservedLine } from "../ink/ReservedLine";

/** Global naming preferences use the existing RPC seam even before a Project is open. */
export const NamingSettings = (props: { app: App }) => {
  const calls = props.app.forProject("");
  const drafts = draftStorage("naming-settings");
  drafts.validate("settings", v.object({ text: v.string() }));
  const destination = { surface: "settings", object: "namingGuide", recipient: null };
  const draft = () => drafts.list().findLast(item => item.destination.object === "namingGuide");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const [settings, { mutate, refetch }] = createResource(async () => {
    try { return await calls.rpc("daemon.getNaming", null); }
    catch (error) { if (!(error instanceof Error)) throw error; setFailure(error.message);

 return null; }
  });

  const text = () => String(draft()?.value.text ?? settings()?.namingGuide ?? "");

  const save = async (automaticRenaming: boolean, guide: string, revision?: string) => {
    if (!guide.trim()) { setFailure(copy.namingGuideRefusal);

 return; }

    if (saving()) return;
    setSaving(true);

    try {
      await calls.rpc("daemon.setNaming", { automaticRenaming, namingGuide: guide });
      mutate({ automaticRenaming, namingGuide: guide });

      if (revision) drafts.discard(revision);
      setFailure(null);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailure(error.message);
    } finally { setSaving(false); }
  };

  return <>
    <Show when={settings()}>{value => <>
      <Switch checked={value().automaticRenaming} disabled={saving()} description={copy.automaticRenamingHint}
        onCheckedChange={checked => void save(checked, value().namingGuide)}>{copy.automaticRenaming}</Switch>
      <Field.Root class="settings-field settings-naming" invalid={!!failure()}>
        <div class="settings-caption"><Field.Label>{copy.namingGuide}</Field.Label><Field.HelperText>{copy.namingGuideHint}</Field.HelperText></div>
        <Field.Textarea rows={4} spellcheck={false} autocorrect="off" autocapitalize="off" value={text()} onInput={event => {
          const input = event.currentTarget;
          drafts.edit(destination, { text: input.value }, { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }, "ordinary");
        }} />
        <button class="word" data-button="quiet" type="button" disabled={saving()} onClick={() => void save(value().automaticRenaming, text(), draft()?.revision)}>{copy.save}</button>
        <Field.ErrorText asChild={error => <div {...error()}><ReservedLine message={failure()} /></div>} />
      </Field.Root>
    </>}</Show>
    <Show when={!settings() && failure()}><ReservedLine message={failure()}><button data-button="quiet" type="button" onClick={() => void refetch()}>{copy.storageRetry}</button></ReservedLine></Show>
    <ReservedLine message={drafts.problem() ? copy.draftRetention(copy.settings, copy.namingGuide, drafts.problem()!.cause) : null}><button data-button="quiet" type="button" onClick={() => drafts.retry()}>{copy.storageRetry}</button></ReservedLine>
  </>;
};
