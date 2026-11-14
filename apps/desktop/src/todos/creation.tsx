import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor, type Setter } from "solid-js";
import * as v from "valibot";
import type { Actor } from "@contracts/Actor";
import { applied, applying } from "../app/pending";
import { failureOf } from "../app/failureOf";
import { EntryRow } from "../ink/EntryRow";
import { ReservedLine } from "../ink/ReservedLine";
import { registerKeys } from "../keys/registry";
import { todoCreationKeys } from "../shelf/keys";
import { useConnectedProject, useCreation } from "../state/connectedProject";
import { createDraftField } from "../state/draftField";
import { copy } from "./copy";
import { creationSchema } from "./EditableText";

/** The Todo creation form of the Todos tab: its draft, its submission and the field that edits it. */
export const createTodoCreation = (inputs: {
  form: v.SafeParseResult<typeof creationSchema>;
  /** The retained revision a recovery opens; without it the tab creates as usual. */
  retained: { revision: string } | undefined;
  homeExists: (home: string | null) => boolean;
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
  const { form, retained, homeExists, typing, setTyping, createFailure, setCreateFailure, setFiled, active, scope, selectedWorkstream, plusButton, section } = inputs;

  const [creationHome, setCreationHome] = createSignal<string | null>(form.success ? form.output.home : null);
  const [creationOwner, setCreationOwner] = createSignal<string | null>(form.success ? form.output.owner : null);
  const creationTarget = () => ({ surface: "todos", object: "new", recipient: creationHome() });
  // A recovery reopens its retained revision in its own home; any other home follows that home's newest draft.
  const recoveredHome = form.success ? form.output.home : null;
  const draft = createMemo(() => createDraftField(connected.drafts, creationTarget(), creationSchema, untrack(creationHome) === recoveredHome ? retained : undefined));
  const creation = () => draft().draft();

  createEffect(() => {
    if (typing()) onCleanup(connected.drafts.editor(creationTarget()));
  });

  // The recovered revision discarded from another control closes its editor.
  createEffect(() => {
    if (typing() && retained && draft().recovered() && !connected.drafts.list().some(each => each.revision === retained.revision)) setTyping(false);
  });

  let creationRow: HTMLDivElement | undefined;

  registerKeys({ kind: "region", element: () => creationRow }, [{
    chords: ["Enter"],
    when: () => creation()?.status === "unknown" || creation()?.status === "pending",
    run: () => setCreateFailure(copy.draftStatus[creation()?.status ?? "unknown"]),
  }]);

  const retainCreation = (field: HTMLInputElement) => {
    const caret = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };
    const kept = draft().value();

    if (kept.success && kept.output.title === field.value) {
      if (!retained || document.activeElement === field) draft().select(caret);

      return;
    }

    if (field.value === "" && !creation()) return;
    draft().keep({ title: field.value, home: creationHome(), owner: creationOwner() }, caret);
  };

  // EntryRow clears after capturing this revision, so another Enter cannot submit it twice.
  const create = async (title: string) => {
    setCreateFailure(null);
    // Keep the owner captured when the scope-line field opened, even if selection changed.
    const owner: Actor | null = creationOwner() === null ? null : { kind: "agent", id: creationOwner()!, parent: null };
    const home = creationHome();
    const kept = draft();

    if (!homeExists(home)) return;
    const field = document.querySelector<HTMLInputElement>(".todos-tab .entry-field");
    // Enter is the user's Save: a recovered title goes out only on it.
    kept.save();
    const sent = await kept.send(() => applying(() => connected.app.rpc("todo.create", owner === null ? { title, body: null, blockers: null } : { title, body: null, blockers: null, owner })));

    if (sent.kind === "skipped") return;

    // Creation is acknowledged before placement: a failed move must never invite duplicate creation.
    if (sent.kind === "applied") {
      setFiled(count => count + 1);
      const made = sent.result.id;

      if (home !== null) setCreateFailure(await failureOf(() => applied(() => connected.app.rpc("todo.move", { id: made, home }))));

      return;
    }

    setCreateFailure(sent.kind === "refused" ? sent.error.message : copy.draftStatus.unknown);
    const restored = kept.value();

    // EntryRow clears on submit; an untouched field takes back the text the field still follows.
    if (field?.isConnected && field.value === "" && draft() === kept && restored.success) field.value = restored.output.title;
  };

  const openField = (home = selectedWorkstream(), owner = scope.agent()?.id ?? null) => {
    setCreateFailure(null);

    if (typing()) {
      document.querySelector<HTMLInputElement>(".todos-tab .entry-field")?.focus();

      return;
    }

    setCreationHome(home);
    setCreationOwner(owner);
    const saved = draft().value();

    if (saved.success) setCreationOwner(saved.output.owner);

    if (creation() && !saved.success) {
      setCreateFailure(copy.draftRetention(connected.project.name, copy.draftSurface("todos"), "invalid"));

      return;
    }

    setTyping(true);
  };

  useCreation("todo", home => {
    setTyping(false);
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
          const kept = draft().value();

          return { text: kept.success ? kept.output.title : "", selection: creation()?.selection ?? null };
        })}
        onEdit={retainCreation}
        onSubmit={(title) => void create(title)}
        onClose={(reason) => {

          setTyping(false);

          if (reason === "escape") setCreateFailure(null);

          if (reason !== "blur") plusButton()?.focus();
        }}
      />
      <ReservedLine message={createFailure()} dismiss={() => setCreateFailure(null)} content={createFailure() ? <>{copy.failed(copy.addTodo, "")}<span>{createFailure()}</span></> : undefined} />
    </div>
  );

  return { creationHome, creation, openField, field };
};
