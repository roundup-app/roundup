import { batch, createEffect, createSignal, onCleanup, untrack, type Accessor, type Setter } from "solid-js";
import * as v from "valibot";
import type { Actor } from "@contracts/Actor";
import { applied } from "../app/pending";
import { outcomeOf } from "../app/seam";
import { EntryRow } from "../ink/EntryRow";
import { ReservedLine } from "../ink/ReservedLine";
import { registerKeys } from "../keys/registry";
import { todoCreationKeys } from "../shelf/keys";
import { useConnectedProject, useCreation } from "../state/connectedProject";
import { copy } from "./copy";
import { creationSchema } from "./EditableText";

/** The Todo creation form of the Todos tab: its draft, its submission and the field that edits it. */
export const createTodoCreation = (inputs: {
  recovery: boolean;
  form: v.SafeParseResult<typeof creationSchema>;
  homeExists: (home: string | null) => boolean;
  creationRevision: Accessor<string | null>;
  setCreationRevision: Setter<string | null>;
  typing: Accessor<boolean>;
  setTyping: Setter<boolean>;
  createFailure: Accessor<string | null>;
  setCreateFailure: Setter<string | null>;
  setFiled: Setter<number>;
  active: Accessor<boolean>;
  scope: { agent: () => { id: string } | null | undefined };
  selectedWorkstream: Accessor<string | null>;
  plusButton: () => HTMLButtonElement | undefined;
  section: () => HTMLElement | undefined;
}) => {
  const connected = useConnectedProject();
  const { form, homeExists, creationRevision, setCreationRevision, typing, setTyping, createFailure, setCreateFailure, setFiled, active, scope, selectedWorkstream, plusButton, section } = inputs;
  const props = { recovery: inputs.recovery };

  const [creationHome, setCreationHome] = createSignal<string | null>(form.success ? form.output.home : null);
  const [creationOwner, setCreationOwner] = createSignal<string | null>(form.success ? form.output.owner : null);
  const creationRecipient = creationHome;
  const creationTarget = () => ({ surface: "todos", object: "new", recipient: creationRecipient() });

  createEffect(() => {
    if (typing()) onCleanup(connected.drafts.editor(creationTarget()));
  });

  const creation = () => connected.drafts.list().findLast(draft => draft.destination.surface === "todos"
    && draft.destination.object === "new" && draft.destination.recipient === creationRecipient()
    && (creationRevision() !== null ? draft.revision === creationRevision() : (draft.status === "draft" || draft.status === "failed" || draft.status === "unknown" || draft.status === "pending")));

  createEffect(() => {
    const revision = creationRevision();

    if (typing() && revision !== null && !creation()) setTyping(false);
  });

  let creationRow: HTMLDivElement | undefined;

  registerKeys({ kind: "region", element: () => creationRow }, [{
    chords: ["Enter"],
    when: () => creation()?.status === "unknown" || creation()?.status === "pending",
    run: () => setCreateFailure(copy.draftStatus[creation()?.status ?? "unknown"]),
  }]);

  const retainCreation = (field: HTMLInputElement) => {
    const previous = creation();
    const caret = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };

    if (creationRevision() !== null && !previous) return;

    if (previous?.value.title === field.value) {
      if ((!props.recovery || document.activeElement === field) && JSON.stringify(previous.selection) !== JSON.stringify(caret)) connected.drafts.setSelection(previous.revision, caret);

      return;
    }

    if (field.value === "" && !previous) return;

    batch(() => setCreationRevision(connected.drafts.edit(creationTarget(), { title: field.value, home: creationHome(), owner: creationOwner() }, caret, "ordinary", creationRevision()).draft.revision));
  };

  // EntryRow clears after capturing this revision, so another Enter cannot submit it twice.
  const create = async (title: string) => {
    setCreateFailure(null);
    // Keep the owner captured when the scope-line field opened, even if selection changed.
    const owner: Actor | null = creationOwner() === null ? null : { kind: "agent", id: creationOwner()!, parent: null };

    const draft = creation();

    const home = creationHome();
    const recipient = creationRecipient();

    if (!homeExists(home) || !draft || !(await connected.drafts.submit(draft.revision))) return;

    if (creationRevision() === draft.revision) setCreationRevision(null);
    const field = document.querySelector<HTMLInputElement>(".todos-tab .entry-field");

    try {
      const made = await applied(() => connected.app.rpc("todo.create", owner === null ? { title, body: null, blockers: null } : { title, body: null, blockers: null, owner }));
      setFiled(count => count + 1);
      // Creation is acknowledged before placement: a failed move must never invite duplicate creation.
      connected.drafts.settle(draft.revision, "acknowledged");

      if (home !== null) await applied(() => connected.app.rpc("todo.move", { id: made.id, home }));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      connected.drafts.settle(draft.revision, outcomeOf(error));
      setCreateFailure(error.message);
      const retained = v.safeParse(v.string(), draft.value.title);

      // EntryRow clears on submit; restore only this field's unchanged failed revision.
      if (field?.isConnected && field.value === "" && creationRecipient() === recipient && (!creation() || creation()?.revision === draft.revision) && retained.success) { field.value = retained.output; setCreationRevision(draft.revision); }
    }
  };

  const openField = (home = selectedWorkstream(), owner = scope.agent()?.id ?? null) => {
    setCreateFailure(null);

    if (typing()) {
      document.querySelector<HTMLInputElement>(".todos-tab .entry-field")?.focus();

      return;
    }

    setCreationHome(home);
    setCreationOwner(owner);
    const draft = creation();
    const saved = v.safeParse(creationSchema, draft?.value);

    if (saved.success) setCreationOwner(saved.output.owner);

    if (draft && !v.safeParse(v.string(), draft.value.title).success) {
      setCreateFailure(copy.draftRetention(connected.project.name, copy.draftSurface("todos"), "invalid"));

      return;
    }

    setCreationRevision(draft?.revision ?? null);
    setTyping(true);
  };

  useCreation("todo", home => {
    setTyping(false);
    setCreationRevision(null);
    openField(home, null);
  });
  todoCreationKeys({ section: section, active, editing: typing, home: selectedWorkstream, owner: () => scope.agent()?.id ?? null, open: openField });

  const field = () => (
    <div class="shelf-list todo-create" ref={element => { creationRow = element; }}>

      <EntryRow
        glyph={<input type="checkbox" class="todo-tick" disabled tabIndex={-1} aria-hidden="true" />}
        class="todo-inset"
        label={copy.newTodoTitle}
        placeholder={copy.newTodoPlaceholder}
        initial={untrack(() => {
          const draft = creation();
          const title = v.safeParse(v.string(), draft?.value.title);

          return { text: title.success ? title.output : "", selection: draft?.selection ?? null };
        })}
        onEdit={retainCreation}
        onSubmit={(title) => void create(title)}
        onClose={(reason) => {

          setTyping(false);

          if (reason === "escape") setCreateFailure(null);

          if (reason !== "blur") plusButton()?.focus();
        }}
      />
      <ReservedLine message={createFailure()} content={createFailure() ? <>{copy.failed(copy.addTodo, "")}<span>{createFailure()}</span></> : undefined} />
    </div>
  );

  return { creationHome, creation, openField, field };
};
