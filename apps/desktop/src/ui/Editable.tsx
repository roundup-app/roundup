import { captureFocus } from "../keys/focus";
import { Editable as ArkEditable } from "@ark-ui/solid/editable";

export const Editable = {
  ...ArkEditable,
  Root: (props: ArkEditable.RootProps) => {
    let finalFocus = captureFocus();

    return <ArkEditable.Root selectOnFocus autoResize {...props} onEditChange={details => {
      if (!details.edit) finalFocus = captureFocus();
      props.onEditChange?.(details);
    }} finalFocusEl={props.finalFocusEl ? () => finalFocus.target(props.finalFocusEl!) : undefined} class={`app-editable ${props.class ?? ""}`} />;
  },
};

import { createEffect, createSignal, onCleanup } from "solid-js";
import * as v from "valibot";
import { useConnectedProject } from "../state/connectedProject";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { outcomeOf } from "../app/seam";

const nameSchema = v.strictObject({ text: v.string(), base: v.string(), version: v.nullable(v.string()) });

/** Row edits keep their original object and version through navigation and a refused save. */
export const NameField = (props: {
  object: string;
  name: string;
  version: () => Promise<string | null>;
  commit: (text: string, base: string, version: string | null) => Promise<void>;
  close: (restore?: boolean) => void;
  fail: (message: string | null) => void;
}) => {
  const { drafts, project } = useConnectedProject();
  const destination = { surface: "row-name", object: props.object, recipient: null };
  drafts.validate(destination.surface, nameSchema);
  const records = () => drafts.list().filter(draft => draft.destination.surface === destination.surface && draft.destination.object === destination.object);
  const restored = records().at(-1);
  const parsed = v.safeParse(nameSchema, restored?.value);
  const [text, setText] = createSignal(parsed.success ? parsed.output.text : props.name);
  const base = parsed.success ? parsed.output.base : props.name;
  const [version, setVersion] = createSignal<string | null>(parsed.success ? parsed.output.version : null);
  const [ready, setReady] = createSignal(parsed.success);
  const [pending, setPending] = createSignal(false);
  let revision = restored?.revision ?? null;
  let alive = true;
  onCleanup(() => { alive = false; });
  onCleanup(drafts.editor(destination));

  const loading = parsed.success ? Promise.resolve(version()) : props.version().then(value => { if (alive) { setVersion(value); setReady(true); } }).catch(error => {
    if (!(error instanceof Error)) throw error;
    props.fail(error.message);
  });

  const conflict = () => props.name !== base;

  const retain = (field: HTMLInputElement) => {
    const selection = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };
    revision = drafts.edit(destination, { text: field.value, base, version: version() }, selection, "ordinary", revision).draft.revision;
  };

  const submit = async (field: HTMLInputElement) => {
    if (!ready()) await loading;

    if (!alive || !ready() || pending() || conflict() || text().trim() === "") return;
    retain(field);
    const value = text().trim();
    setPending(true);
    const submitted = revision === null ? null : await drafts.submit(revision);

    if (!submitted) {
      setPending(false);

      return;
    }

    try {
      await props.commit(value, base, version());
      drafts.settle(submitted.draft.revision, "acknowledged");

      if (alive && revision === submitted.draft.revision) { props.fail(null); props.close(); }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      drafts.settle(submitted.draft.revision, outcomeOf(error));
      props.fail(error.message);
    } finally { if (alive) setPending(false); }
  };

  createEffect(() => {
    const problem = drafts.problem();

    if (problem && (!problem.destination || problem.destination.object === destination.object)) props.fail(copy.draftRetention(project.name, copy.name, problem.cause));
  });

  // This editor restores its own selection; Ark's deferred select-all would overwrite it.
  return <Editable.Root edit selectOnFocus={false} value={text()} submitMode="none" class="row-name-editor" onValueChange={({ value }) => setText(value)}>
    <Editable.Input spellcheck={false} autocorrect="off" autocapitalize="off" type="text" class="shelf-title" aria-label={copy.name} aria-invalid={conflict() || undefined} aria-busy={!ready() || pending()} ref={field => queueMicrotask(() => {
      if (!field.isConnected) return;
      field.focus();

      if (restored?.selection) field.setSelectionRange(restored.selection.start, restored.selection.end, restored.selection.direction);
      else field.select();
    })} onInput={event => { setText(event.currentTarget.value); retain(event.currentTarget); }}
    onSelect={event => { if (event.currentTarget.isConnected && revision !== null) drafts.setSelection(revision, { start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0, direction: event.currentTarget.selectionDirection ?? "none" }); }}
    on:keydown={event => {
      event.stopPropagation();

      if (event.key === "Enter") { event.preventDefault();

 if (!event.repeat) void submit(event.currentTarget); }

      if (event.key === "Escape") { event.preventDefault(); props.close(); }
    }} onBlur={() => props.close(false)} />
    <ReservedLine overlay message={conflict() ? copy.railDraftConflict : null} />
  </Editable.Root>;
};
