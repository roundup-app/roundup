import { queueFocus } from "../keys/focus";
import { BusyButton } from "../ui/BusyButton";
import { copy } from "./copy";
import { LabelGroup } from "./NoteExtras";
import { NoteView, statusOf } from "./NoteView";
import { itemNotes, itemOf, sameItem } from "./itemNotes";
import { createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { Extras } from "./NoteExtras";
import type { ItemTarget } from "./itemNotes";
import { itemFormOf } from "./notes";
import type { Item, ItemNote, Notes } from "./notes";

/** U7691a: the form open on an item, and the unsent note it edits. */
export type Composing = {
  item: Pick<Item, "kind" | "name">;
  editing?: ItemNote;
};

type Fields = { text: string; label: Extras["label"] };

/** U7691a: the field of a note on a module, flow or file: its text and label, no lines and no replacement; Esc keeps typed text as unfinished work (U2773a). */
const ItemNoteForm = (props: {
  id: string;
  notes: Notes;
  target: ItemTarget;
  editing?: ItemNote | undefined;
  close: () => void;
}) => {
  const { restored, editing } = untrack(() => ({
    restored: itemFormOf(props.notes, props.id, props.target, props.editing?.id),
    editing: props.editing,
  }));

  const revision = restored?.revision ?? crypto.randomUUID();
  const replacing = restored?.replacing ?? editing?.id;

  const initial: Fields = {
    text: restored?.text ?? editing?.text ?? "",
    label: restored?.label ?? editing?.label ?? null,
  };

  const [fields, setFields] = createSignal(initial);

  // The retained form must carry what the last edit wrote, so `written` keeps it ahead of the signal.
  let written = initial;
  let field: HTMLTextAreaElement | undefined;
  let disposed = false;
  // A stored note ends its field's draft: from the Save click to the close no late write keeps it.
  let closing = false;

  onCleanup(() => {
    disposed = true;
  });

  const selection = () =>
    field
      ? {
          start: field.selectionStart,
          end: field.selectionEnd,
          direction: field.selectionDirection,
        }
      : (restored?.selection ?? null);

  const labelled = (label: Fields["label"]) =>
    label === null ? {} : { label };

  const persist = () => {
    if (!closing)
      props.notes.editForm(props.id, {
        revision,
        item: itemOf(props.target),
        replacing: replacing ?? null,
        text: written.text,
        ...labelled(written.label),
        selection: selection(),
      });
  };

  const edit = (change: Partial<Fields>) => {
    written = { ...written, ...change };
    setFields(written);
    persist();
  };

  const valid = () =>
    fields().text.trim() !== "" &&
    (replacing !== undefined || props.notes.list(props.id).length < 200);

  const save = async () => {
    const submitted = fields().text;

    if (!valid()) return;
    closing = true;

    const stored = await props.notes.save(
      props.id,
      {
        item: itemOf(props.target),
        text: submitted,
        ...labelled(fields().label),
      },
      replacing,
      revision,
    );

    closing = stored && !disposed && fields().text === submitted;

    if (closing) props.close();
  };

  const leave = () => {
    if (
      fields().text.trim() === "" ||
      (editing !== undefined &&
        fields().text === editing.text &&
        fields().label === (editing.label ?? null))
    )
      void props.notes.discardForm(props.id, revision);
    props.close();
  };

  return (
    <form
      class="note-form"
      data-surface="diff"
      aria-label={copy.noteOn[props.target.kind]}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          leave();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label class="note-field">
        {copy.note}
        <textarea
          class="note-input field-inline"
          rows={Math.min(12, Math.max(2, fields().text.split("\n").length))}
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          value={fields().text}
          maxlength={20000}
          onInput={(event) => edit({ text: event.currentTarget.value })}
          onSelect={() => {
            if (written.text !== "" || restored || replacing !== undefined)
              persist();
          }}
          ref={(element) => {
            field = element;
            queueFocus(() => {
              if (!element.isConnected) return;
              element.focus();

              if (restored?.selection)
                element.setSelectionRange(
                  restored.selection.start,
                  restored.selection.end,
                  restored.selection.direction,
                );
            });
          }}
        />
      </label>
      <LabelGroup label={fields().label} edit={edit} />
      <div class="diff-actions">
        <p class="note-hint">{copy.saveHint}</p>
        <BusyButton
          kind="quiet"
          type="submit"
          disabled={!valid()}
          busyLabel={copy.saving}
          onClick={(event) => {
            event.preventDefault();

            return save();
          }}
        >
          {copy.save}
        </BusyButton>
      </div>
    </form>
  );
};

/** U7691d: the notes on one item, each under its header, and the form when it is open on that item. */
export const ItemNotes = (props: {
  id: string;
  notes: Notes;
  target: ItemTarget;
  form: Composing | undefined;
  setForm: (form: Composing | undefined) => void;
  outdated: (note: ItemNote) => boolean;
}) => {
  const mine = () =>
    itemNotes(props.notes.all(props.id)).filter((note) =>
      sameItem(note.item, props.target),
    );

  const open = () =>
    props.form !== undefined && sameItem(props.form.item, props.target)
      ? props.form
      : undefined;

  return (
    <>
      <For each={mine()}>
        {(note) => (
          <Show when={open()?.editing?.id !== note.id}>
            <NoteView
              note={note}
              status={statusOf(props.notes, props.id, note, () => props.outdated(note))}
              edit={() => props.setForm({ item: props.target, editing: note })}
              remove={() => {
                void props.notes.remove(props.id, note.id);
              }}
            />
          </Show>
        )}
      </For>
      <Show when={open()} keyed>
        {(form) => (
          <ItemNoteForm
            id={props.id}
            notes={props.notes}
            target={props.target}
            editing={form.editing}
            close={() => props.setForm(undefined)}
          />
        )}
      </Show>
    </>
  );
};
