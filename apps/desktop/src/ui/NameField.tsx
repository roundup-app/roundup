import { makeEventListener } from "@solid-primitives/event-listener";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import * as v from "valibot";
import { applying } from "../app/pending";
import { StatusNote } from "../ink/MountedLine";
import { useConnectedProject } from "../state/connectedProject";
import { createDraftField } from "../state/draftField";
import { copy } from "./copy";
import { Editable } from "./Editable";

const nameSchema = v.strictObject({ text: v.string(), base: v.string(), version: v.optional(v.nullable(v.string()), null) });

/** A name edited in the place it reads (U7641a): one field for a Rail, Todo or Pad row, keeping its row and version through navigation and a refused save. */
export const NameField = (props: {
  object: string;
  name: string;
  /** The draft surface; Rail names keep their own. */
  surface?: string;
  /** A Rail name takes no title class. */
  plain?: boolean;
  /** The version a save expects, read once on opening; a name with none (a Rail name) saves at once. */
  version?: () => Promise<string | null>;
  commit: (text: string, base: string, version: string | null) => Promise<void>;
  close: (restore?: boolean) => void;
  fail: (message: string | null) => void;
}) => {
  const { drafts, project } = useConnectedProject();
  // The field is made for one row and the name it has now: it reads both once.
  const { object, current, surface, read, commit } = untrack(() => ({ object: props.object, current: props.name, surface: props.surface ?? "row-name", read: props.version, commit: props.commit }));
  const destination = { surface, object, recipient: null };
  drafts.validate(surface, nameSchema);
  const draft = createDraftField(drafts, destination, nameSchema);
  const restored = untrack(draft.value);
  const base = restored.success ? restored.output.base : current;
  const [version, setVersion] = createSignal<string | null>(restored.success ? restored.output.version : null);
  const [ready, setReady] = createSignal(restored.success || read === undefined);
  onCleanup(drafts.editor(destination));

  const loading = read === undefined || untrack(ready) ? Promise.resolve() : read().then(value => { setVersion(value); setReady(true); }).catch(error => {
    if (!(error instanceof Error)) throw error;
    props.fail(error.message);
  });

  const text = () => {
    const kept = draft.draft()?.value.text;

    return v.is(v.string(), kept) ? kept : current;
  };

  const conflict = () => props.name !== base;

  const caretOf = (field: HTMLInputElement) => ({ start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" });

  const capture = (field: HTMLInputElement) => draft.keep({ text: field.value, base, version: version() }, caretOf(field));

  const submit = async (field: HTMLInputElement) => {
    if (!ready()) await loading;

    if (!field.isConnected || !ready() || conflict()) return;
    capture(field);
    const value = text().trim();

    if (value === "") return props.close();
    // Enter is the owner's own send, so a recovered name goes too.
    draft.save();
    const expected = version();
    const sent = await draft.send(() => applying(() => commit(value, base, expected)));

    if (sent.kind === "refused") props.fail(sent.error.message);
    else if (field.isConnected && sent.kind === "applied" && draft.draft()?.status !== "draft") { props.fail(null); props.close(); }
  };

  createEffect(() => ({ problem: drafts.problem(), name: project.name }), ({ problem, name }) => {
    if (problem && (!problem.destination || problem.destination.object === destination.object)) props.fail(copy.draftRetention(name, copy.name, problem.cause));
  });

  // This editor restores its own selection; the editable's deferred select-all would overwrite it.
  return <Editable.Root edit selectOnFocus={false} value={text()} submitMode="none" class="row-name-editor">
    <Editable.Input spellcheck="false" autocorrect="off" autocapitalize="off" type="text" class={`${props.plain ? "" : "shelf-title "}field-inline`} aria-label={copy.name} aria-invalid={conflict() || draft.draft()?.status === "failed" ? "true" : undefined} aria-busy={!ready() ? "true" : "false"} ref={field => {
      // A native listener: the stop must also reach document-level key handlers, which a delegated one cannot.
      makeEventListener(field, "keydown", event => {
        event.stopPropagation();

        if (event.key === "Enter") {
          event.preventDefault();

          if (!event.repeat) void submit(field);
        }

        if (event.key === "Escape") { event.preventDefault(); props.close(); }
      });

      queueMicrotask(() => {
        if (!field.isConnected) return;
        field.focus();
        const selection = untrack(draft.draft)?.selection;

        if (selection) field.setSelectionRange(selection.start, selection.end, selection.direction);
        else field.select();
      });
    }} onInput={event => capture(event.currentTarget)}
    onSelect={event => { if (event.currentTarget.isConnected && draft.draft()?.status === "draft") capture(event.currentTarget); }}
    onBlur={() => props.close(false)} />
    <StatusNote text={conflict() ? copy.railDraftConflict : null} />
  </Editable.Root>;
};
