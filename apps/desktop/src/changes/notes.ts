import { outcomeOf } from "../app/seam";
import { copy } from "./copy";
import { createNoteMemory, noteStateOf } from "./noteMemory";
import { createReadYourWrites } from "./readYourWrites";
import { createSignal, untrack } from "solid-js";
import * as v from "valibot";
import { parse, stringify } from "flatted";
import { draftStorage } from "../state/storage";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Message } from "@contracts/message/Message";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";

const content = v.variant("kind", [
  v.strictObject({ kind: v.literal("absent"), revision: v.string() }),
  v.strictObject({ kind: v.literal("binary"), revision: v.string() }),
  v.strictObject({ kind: v.literal("text"), revision: v.string(), text: v.string() }),
  // U7694: a draft holds no picture bytes, so `data` is never kept.
  v.strictObject({ kind: v.literal("image"), revision: v.string(), mime: v.string(), size: v.number() }),
]);

const comparison = v.strictObject({
  base: v.string(), oldPath: v.string(), newPath: v.string(),
  status: v.nullable(v.picklist(["added", "modified", "deleted", "renamed", "untracked"])), old: content, new: content,
});

const offset = v.pipe(v.number(), v.integer(), v.minValue(0));

const line = v.pipe(v.number(), v.integer(), v.minValue(1));

const caret = v.nullable(v.strictObject({ start: offset, end: offset, direction: v.picklist(["forward", "backward", "none"]) }));

/** U7690a: a note's optional label; its data value is its word in lower case. */
export const LABELS = ["question", "nit", "issue"] as const;

const label = v.picklist(LABELS);

export type Label = v.InferOutput<typeof label>;

const lineSchema = v.strictObject({
  id: line, revision: v.string(), comparison, side: v.picklist(["old", "new"]),
  start: line, end: line, source: v.string(), text: v.string(), selection: v.optional(caret),
  // U7677e: when the Agent accepted the note (ms); a note without it is unsent.
  sent: v.optional(offset),
  // U7956a: the Message that carried it, and when it landed (ms); a note with a `message` and no `landed` is Waiting.
  message: v.optional(offset), landed: v.optional(offset),
  // U7690a, U7690b: the label and the replacement text, each only when set.
  label: v.optional(label), replacement: v.optional(v.string()),
});

/** U7691: the item a note names, a file, module or flow of the Changes list, by the item's `name`; `blobs` holds each file's `blob` when the note was made, `title` the words it was made under. */
const itemSchema = v.strictObject({ kind: v.picklist(["file", "module", "flow"]), name: v.string(), title: v.string(), blobs: v.record(v.string(), v.nullable(v.string())) });

const itemNoteSchema = v.strictObject({ id: line, revision: v.string(), item: itemSchema, text: v.string(), sent: v.optional(offset), message: v.optional(offset), landed: v.optional(offset), label: v.optional(label) });

const noteSchema = v.union([lineSchema, itemNoteSchema]);

const lineFormSchema = v.strictObject({
  revision: v.string(), comparison, replacing: v.nullable(line),
  side: v.picklist(["old", "new"]), start: v.string(), end: v.string(), text: v.string(),
  selection: caret, label: v.optional(label), replacement: v.optional(v.string()),
});

const itemFormSchema = v.strictObject({ revision: v.string(), item: itemSchema, replacing: v.nullable(line), text: v.string(), selection: caret, label: v.optional(label) });

const formSchema = v.union([lineFormSchema, itemFormSchema]);

const submissionSchema = v.strictObject({
  revision: v.string(), notes: v.array(noteSchema), body: v.string(), previous: v.nullable(v.array(offset)),
  status: v.picklist(["pending", "unknown", "failed"]), text: v.string(),
});

const savedRecipientSchema = v.strictObject({ version: v.literal(1), notes: v.array(noteSchema), forms: v.array(formSchema), submissions: v.array(submissionSchema) });

const recipientSchema = v.strictObject({ ...savedRecipientSchema.entries, recovered: v.array(v.strictObject({ revision: v.string(), data: savedRecipientSchema })) });

export type LineNote = v.InferOutput<typeof lineSchema>;

export type ItemNote = v.InferOutput<typeof itemNoteSchema>;

export type Item = v.InferOutput<typeof itemSchema>;

export type Note = LineNote | ItemNote;

export type NoteFormDraft = v.InferOutput<typeof lineFormSchema>;

export type ItemFormDraft = v.InferOutput<typeof itemFormSchema>;

export type Form = NoteFormDraft | ItemFormDraft;

/** U7691: a note or an unfinished form on an item, not on lines. */
export const isItem = <T extends object>(value: T): value is Extract<T, { item: Item }> => "item" in value;

/** U7691: a note or an unfinished form on lines. */
export const isLine = <T extends object>(value: T): value is Exclude<T, { item: Item }> => !("item" in value);

/** What a note or form names first: an item's title, a line note's path. */
export const titleOf = (note: Note | Form) => isItem(note) ? note.item.title : note.comparison.newPath;

/** The files of an item, in the order it recorded them. */
export const filesOf = (item: Item) => Object.keys(item.blobs);

type Submission = v.InferOutput<typeof submissionSchema>;

type Recipient = v.InferOutput<typeof recipientSchema>;

/** Valibot checks the library graph without replacing shared comparison objects. */
const parseRecipient = (data: string): Recipient => {
  const value: unknown = parse(data);

  v.assert(recipientSchema, value);

  return value;
};

type Send = { kind: "idle"; text: string; sent?: number } | { kind: "failed"; text: string; submission: string; notes: readonly number[] | null } | { kind: "pending" } | { kind: "unknown"; submission: Submission; text: string };

const stores = new WeakMap<AppSeam["rpc"], Map<string, ReturnType<typeof createNotes>>>();

const owners = new WeakMap<ReturnType<typeof draftStorage>, Map<string, ReturnType<typeof createNotes>>>();

/** Connected surfaces use the App's Project owner, including after RPC replacement.
 * Standalone observers can look up the connected RPC's store without reaching into App state. */
export const notesFor = (app: AppSeam, project: string, drafts?: ReturnType<typeof draftStorage>) => {
  let projects = drafts ? owners.get(drafts) : stores.get(app.rpc);

  if (!projects) {
    projects = new Map();

    if (drafts) owners.set(drafts, projects); else stores.set(app.rpc, projects);
  }

  let store = projects.get(project);

  if (!store) { store = createNotes(app, project, drafts ?? draftStorage(project)); projects.set(project, store); }

  let calls = stores.get(app.rpc);

  if (!calls) { calls = new Map(); stores.set(app.rpc, calls); }

  calls.set(project, store);
  store.setApp(app);

  return store.notes;
};

/** RPC replies have a 15-second bound; mutations distinguish rejection from lost acceptance. */
export const reply = async <T>(call: () => Promise<T>): Promise<{ kind: "ok"; value: T } | { kind: "failed" | "unknown"; text: string }> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      call().then(value => ({ kind: "ok" as const, value })),
      new Promise<{ kind: "unknown"; text: string }>(resolve => { timer = setTimeout(() => resolve({ kind: "unknown", text: copy.notesNoReply }), 15_000); }),
    ]);
  } catch (error) {
    if (!(error instanceof Error)) throw error;

    return { kind: outcomeOf(error), text: error.message };
  } finally { clearTimeout(timer); }
};

/** U7691b: an item note's entry: its `Group:` in place of `Lines:`, and the `blob` of each file it recorded. */
const itemEntryOf = (note: ItemNote) => ({ "Group:": { kind: note.item.kind, name: note.item.title, files: filesOf(note.item) }, "Content revisions:": note.item.blobs, "User comment:": note.text });

/** One note's entry in the Message body: `Label:` and `Replacement:` only when set (U7690a, U7690b). */
const entryOf = (note: Note) => {
  if (isItem(note)) return note.label === undefined ? itemEntryOf(note) : { ...itemEntryOf(note), "Label:": note.label };

  const entry = { "File:": { old: note.comparison.oldPath, new: note.comparison.newPath }, "Base:": note.comparison.base, "Content revisions:": { old: note.comparison.old.revision, new: note.comparison.new.revision }, "Lines:": `${note.side} ${note.start}-${note.end}`, "Selected source:": note.source, "User comment:": note.text };
  const labelled = note.label === undefined ? entry : { ...entry, "Label:": note.label };

  return note.replacement === undefined ? labelled : { ...labelled, "Replacement:": note.replacement };
};

const bodyOf = (notes: readonly Note[]) => JSON.stringify({ description: copy.notesDescription, notes: notes.map(entryOf) }, null, 2);

/** A form that repeats another: native selection events can repeat after restoring the same caret, and a no-op must not rebuild the editor. */
const sameCaret = (left: Pick<Form, "selection">, right: Pick<Form, "selection">) => left.selection?.start === right.selection?.start && left.selection?.end === right.selection?.end && left.selection?.direction === right.selection?.direction;

const sameLineForm = (left: NoteFormDraft, right: NoteFormDraft) => left.comparison === right.comparison && left.replacing === right.replacing && left.side === right.side && left.start === right.start && left.end === right.end && left.text === right.text && left.label === right.label && left.replacement === right.replacement && sameCaret(left, right);

const sameItemForm = (left: ItemFormDraft, right: ItemFormDraft) => left.item.kind === right.item.kind && left.item.name === right.item.name && left.replacing === right.replacing && left.text === right.text && left.label === right.label && sameCaret(left, right);

const sameForm = (left: Form, right: Form) => isItem(left) ? isItem(right) && sameItemForm(left, right) : !isItem(right) && sameLineForm(left, right);

/** The rows a record that would not load still holds: copy preserves even records without readable note fields. */
const previewOf = (data: string): (Note | Form)[] => {
  try {
    const row = v.nullable(v.union([noteSchema, formSchema]));
    const rows = v.fallback(v.array(v.fallback(row, null)), []);
    const result = v.parse(v.looseObject({ notes: rows, forms: rows }), parse(data));

    return [...result.notes, ...result.forms].filter(value => value !== null);
  } catch { return []; }
};

/** The highest note number a record holds, in its notes, its sent batches, its forms and its recovered work. */
const highestId = (value: Recipient) => {
  let highest = 0;

  for (const batch of [value, ...value.recovered.map(entry => entry.data)]) {
    for (const note of [...batch.notes, ...batch.submissions.flatMap(submission => submission.notes)]) highest = Math.max(highest, note.id);

    for (const form of batch.forms) highest = Math.max(highest, form.replacing ?? 0);
  }

  return highest;
};

/** U7956a: a note the Agent accepted carries its Message; it is Sent once that Message lands. */
const stamped = (note: Note, message: Message, landedAt: number | null): Note => {
  const marked = { ...note, sent: Date.now(), message: message.id };

  if (message.status === "delivered") marked.landed = Date.now();
  else if (landedAt !== null) marked.landed = landedAt;

  return marked;
};

/** U7956a: a Message landing turns the notes it carried Sent; one folded into a later delivery (`merged`) lands with the next delivery to its Agent. */
const createLanding = <R extends { notes: Note[] }>(recipients: () => ReadonlyMap<string, R>, retain: (key: string, value: R) => Promise<void> | void) => {
  const merged = new Map<number, string>();
  const delivered = new Map<number, number>();
  const latest = new Map<string, { id: number; at: number }>();
  const waiting = (note: Note, ids: Set<number>) => note.message !== undefined && note.landed === undefined && ids.has(note.message);

  const land = (message: Message): [string, R][] => {
    if (message.status === "dropped" && message.reason === "merged") merged.set(message.id, message.to);

    if (message.status !== "delivered") return [];

    delivered.set(message.id, Date.now());
    latest.set(message.to, { id: message.id, at: Date.now() });

    const folded = [...merged].flatMap(([id, to]) => to === message.to && id < message.id ? [id] : []);
    const ids = new Set([message.id, ...folded]);

    return [...recipients()].flatMap(([key, value]): [string, R][] => value.notes.some(note => waiting(note, ids)) ? [[key, { ...value, notes: value.notes.map(note => waiting(note, ids) ? { ...note, landed: Date.now() } : note) }]] : []);
  };

  const follow = (events: Events) => events.subscribe(event => { if (event.name === "message.delivered" || event.name === "message.dropped") for (const [key, value] of land(event.data)) retain(key, value); }, { replay: true });

  /** When the Message landed before its send reply was stamped, directly or through a merging delivery; null while it has not. */
  const landedAt = (message: Message) => {
    const own = delivered.get(message.id);
    const to = merged.get(message.id);
    const next = to === undefined ? undefined : latest.get(to);

    return own ?? (next && next.id > message.id ? next.at : null);
  };

  return { follow, landedAt };
};

const createNotes = (firstApp: AppSeam, project: string, storage: ReturnType<typeof draftStorage>) => {
  let app = firstApp;
  const records = () => storage.list().filter(draft => draft.destination.surface === "changes" && draft.policy === "ordinary");
  const restored = new Map<string, Recipient>();
  const invalid = new Set<string>();
  const restoredRevisions = new Map<string, string>();
  let next = 0;

  const load = () => {
    for (const draft of records()) {
      const id = draft.destination.recipient;

      try {
        const value = parseRecipient(String(draft.value.data));

        if (id === null || draft.destination.object !== id) { invalid.add(draft.revision); continue; }

        const previous = restored.get(id);
        const older = previous ? [...previous.recovered, { revision: restoredRevisions.get(id) ?? draft.revision, data: { version: previous.version, notes: previous.notes, forms: previous.forms, submissions: previous.submissions } }] : [];

        restored.set(id, { ...value, recovered: [...value.recovered, ...older], submissions: value.submissions.map(submission => submission.status === "pending" ? { ...submission, status: "unknown", text: copy.notesNoReply } : submission) });
        restoredRevisions.set(id, draft.revision);
        next = Math.max(next, highestId(value));
      } catch { invalid.add(draft.revision); }
    }
  };

  untrack(load);
  const [recipients, holdRecipients] = createReadYourWrites(restored);
  const [sent, holdSends] = createReadYourWrites(new Map<string, Send>());
  const [problem, setProblem] = createSignal(untrack(storage.problem));
  const [invalidCount, setInvalidCount] = createSignal(invalid.size);
  const recipient = (id: string): Recipient => recipients().get(id) ?? { version: 1, notes: [], forms: [], submissions: [], recovered: [] };
  /** U7677e: the batch is the unsent notes; the diff draws every note (`all`), the Sent ones too. */
  const list = (id: string): readonly Note[] => recipient(id).notes.filter(note => note.sent === undefined);

  const state = (id: string): Send => {
    const submission = recipient(id).submissions.find(value => value.status !== "failed");

    if (submission) return submission.status === "pending" ? { kind: "pending" } : { kind: "unknown", submission, text: submission.text };

    return sent().get(id) ?? { kind: "idle", text: "" };
  };

  const { kept, unkeep, gone, undo, removedNote } = createNoteMemory<Note>(new Map([...restored].map(([id, value]) => [id, { notes: value.notes.filter(note => note.sent === undefined) }])), (id, note) => retain(id, { ...recipient(id), notes: [...recipient(id).notes, note].sort((left, right) => left.id - right.id) }));

  const putState = (id: string, value: Send) => holdSends(new Map(sent()).set(id, value));

  const clearItem = (id: string, note: number) => {
    const failed = sent().get(id);

    if (failed?.kind !== "failed" || failed.notes === null) return;
    const remaining = failed.notes.filter(value => value !== note);

    putState(id, remaining.length ? { ...failed, notes: remaining } : { kind: "idle", text: "" });
  };

  const retain = async (id: string, value: Recipient) => {
    const empty = !value.notes.length && !value.forms.length && !value.submissions.length && !value.recovered.length;

    holdRecipients(empty ? new Map([...recipients()].filter(([key]) => key !== id)) : new Map(recipients()).set(id, value));

    // Invalid records are recoverable evidence, never overwritten by a fresh edit.
    if (invalid.size) return;

    if (empty) {
      for (const draft of records()) if (draft.destination.surface === "changes" && draft.destination.recipient === id) setProblem(await storage.discard(draft.revision));
    } else setProblem(await storage.edit({ surface: "changes", object: id, recipient: id }, { data: stringify(value) }, null, "ordinary").retained);
  };

  const landing = createLanding(recipients, retain);

  const accepted = async (id: string, submission: Submission, message: Message) => {
    const current = recipient(id);

    await retain(id, { ...current, notes: current.notes.map(note => submission.notes.some(sent => sent.revision === note.revision) ? stamped(note, message, landing.landedAt(message)) : note), submissions: current.submissions.filter(value => value.revision !== submission.revision) });
    putState(id, { kind: "idle", text: "", sent: submission.notes.length });
  };

  const settle = async (id: string, submission: Submission, status: "failed" | "unknown", text: string, item = true) => {
    const current = recipient(id);

    await retain(id, { ...current, submissions: current.submissions.map(value => value.revision === submission.revision ? { ...submission, status, text } : value) });

    if (status === "failed") putState(id, { kind: "failed", text, submission: submission.revision, notes: item ? submission.notes.map(note => note.id) : null });
  };

  const history = (connection: AppSeam, id: string) => reply(() => connection.rpc("message.list", { to: id, status: null }));

  const notes = {
    list, state, all: (id: string): readonly Note[] => recipient(id).notes,
    failure: (id: string) => {
      const value = sent().get(id);

      return value?.kind === "failed" ? value.text : null;
    },
    dismiss: (id: string) => { if (sent().get(id)?.kind === "failed") putState(id, { kind: "idle", text: "" }); },
    kept,
    dismissKept: unkeep,
    dismissSent: (id: string) => { if (sent().get(id)?.kind === "idle") putState(id, { kind: "idle", text: "" }); },
    removed: (id: string) => gone(id).length > 0,
    undo,
    follow: landing.follow,
    noteState: (id: string, note: Note) => noteStateOf(recipient(id).submissions, sent().get(id), note),
    project,
    entries: () => [...recipients().entries()],
    problem: () => invalidCount() ? copy.notesRestoreFailed(project) : problem() ? copy.notesRetentionFailed(project, problem()?.operation ?? "retain", problem()?.cause ?? "write") : null,
    retry: async () => {
      setProblem(await storage.retry());

      // A recovered read can reveal older work alongside newer memory. Keep both, with no implicit merge or send.
      const saved = records();

      for (const draft of saved) {
        if (draft.destination.recipient === null) continue;
        const id = draft.destination.recipient;

        if (draft.destination.object !== id) { invalid.add(draft.revision); continue; }

        try {
          const value = parseRecipient(String(draft.value.data));

          next = Math.max(next, highestId(value));
          const current = recipients().get(id);

          if (!current) {
            holdRecipients(new Map(recipients()).set(id, { ...value, submissions: value.submissions.map(submission => submission.status === "pending" ? { ...submission, status: "unknown" } : submission) }));
          } else if (JSON.stringify(v.parse(recipientSchema, current)) !== JSON.stringify(v.parse(recipientSchema, value)) && !current.recovered.some(entry => entry.revision === draft.revision)) {
            holdRecipients(new Map(recipients()).set(id, { ...current, recovered: [...current.recovered, { revision: draft.revision, data: { version: value.version, notes: value.notes, forms: value.forms, submissions: value.submissions.map(submission => submission.status === "pending" ? { ...submission, status: "unknown", text: copy.notesNoReply } : submission) } }, ...value.recovered.filter(entry => !current.recovered.some(known => known.revision === entry.revision))] }));
          }
        } catch { invalid.add(draft.revision); }
      }

      setInvalidCount(invalid.size);

      if (!invalid.size) for (const [id, value] of recipients()) await retain(id, value);
    },
    invalid: () => { invalidCount();

      return records().filter(draft => invalid.has(draft.revision)).map(draft => ({ ...draft, preview: previewOf(String(draft.value.data)) })); },
    discardInvalid: async (revision: string) => {
      invalid.delete(revision);
      setInvalidCount(invalid.size);
      setProblem(await storage.discard(revision));

      if (!invalid.size) for (const [id, value] of recipients()) await retain(id, value);
    },
    /** U7676c: the forms holding typed text, each Esc or file switch having kept it as unfinished work. */
    unfinished: (id: string): readonly NoteFormDraft[] => recipient(id).forms.filter(isLine).filter(form => form.text.trim() !== ""),
    form: (id: string, comparison: FileComparison, replacing?: number) => recipient(id).forms.find((form): form is NoteFormDraft => !isItem(form) && form.replacing === (replacing ?? null) && form.comparison.newPath === comparison.newPath),
    editForm: (id: string, form: Form) => {
      const current = recipient(id);
      const previous = current.forms.find(value => value.revision === form.revision);

      // Native selection events can repeat after restoring the same caret; a no-op must not rebuild the editor.
      if (previous && sameForm(previous, form)) return;

      retain(id, { ...current, forms: [...current.forms.filter(value => value.revision !== form.revision), form] });
    },
    discardForm: async (id: string, revision: string) => {
      const current = recipient(id);

      await retain(id, { ...current, forms: current.forms.filter(form => form.revision !== revision) });
    },
    discardRecovered: (id: string, revision: string) => {
      const current = recipient(id);

      retain(id, { ...current, recovered: current.recovered.filter(value => value.revision !== revision) });
    },
    discardSubmission: async (id: string, revision: string) => {
      const current = recipient(id);

      const selected = current.submissions.find(value => value.revision === revision);
      const revisions = new Set(selected?.notes.map(note => note.revision));

      await retain(id, { ...current, notes: current.notes.filter(note => !revisions.has(note.revision)), submissions: current.submissions.filter(value => value.revision !== revision) });

      if (notes.problem()) return;
      const failure = sent().get(id);

      if (failure?.kind === "failed" && failure.notes !== null && failure.submission === revision) putState(id, { kind: "idle", text: "" });

      for (const note of selected?.notes ?? []) if (!list(id).some(value => value.id === note.id)) clearItem(id, note.id);
    },
    save: async (id: string, note: Omit<LineNote, "id" | "revision"> | Omit<ItemNote, "id" | "revision">, replacing?: number, form?: string) => {
      const current = recipient(id);
      const values = current.notes;

      if (replacing === undefined && list(id).length >= 200) return false;
      unkeep(id);

      if (sent().get(id)?.kind === "idle") putState(id, { kind: "idle", text: "" });
      const value = { ...note, id: replacing ?? ++next, revision: crypto.randomUUID() };
      const updated = values.some(old => old.id === replacing) ? values.map(old => old.id === replacing ? value : old) : [...values, value];
      await retain(id, { ...current, notes: updated, forms: current.forms.filter(value => value.revision !== form) });

      if (replacing !== undefined && !notes.problem()) clearItem(id, replacing);

      return true;
    },
    remove: async (id: string, note: number) => {
      const removed = recipient(id).notes.find(value => value.id === note);

      unkeep(id);
      await retain(id, { ...recipient(id), notes: recipient(id).notes.filter(value => value.id !== note) });

      if (removed && !notes.problem()) removedNote(id, removed);

      if (!notes.problem()) clearItem(id, note);
    },
    send: async (id: string) => {
      if (list(id).length === 0 || (state(id).kind === "pending" || state(id).kind === "unknown")) return;
      unkeep(id);
      const connection = app;
      const notes = [...list(id)];
      const submission: Submission = { revision: crypto.randomUUID(), notes, body: bodyOf(notes), previous: null, status: "pending", text: "" };
      await retain(id, { ...recipient(id), submissions: [...recipient(id).submissions, submission] });
      const prior = await history(connection, id);

      if (prior.kind !== "ok") {
        await settle(id, submission, "failed", prior.text, false);

        return;
      }

      submission.previous = prior.value.map(message => message.id);
      await retain(id, { ...recipient(id), submissions: recipient(id).submissions.map(value => value.revision === submission.revision ? { ...submission } : value) });
      const result = await reply(() => connection.rpc("message.send", { to: id, kind: "note", body: submission.body, replyTo: null }));

      if (result.kind === "ok") await accepted(id, submission, result.value);
      else await settle(id, submission, result.kind, result.kind === "unknown" ? copy.notesUnknown(result.text) : result.text);
    },
    reconcile: async (id: string) => {
      const current = state(id);

      if (current.kind !== "unknown") return;
      const submission = current.submission;
      const result = await history(app, id);

      if (result.kind !== "ok") return;

      // A failed metadata write can leave a null baseline even after an accepted send.
      if (submission.previous === null) {
        await settle(id, submission, "unknown", copy.notesNoBaseline);

        return;
      }

      const previous = submission.previous;
      const found = result.value.find(message => !previous.includes(message.id) && message.from.kind === "user" && message.from.id === "you" && message.to === id && message.kind === "note" && message.body === submission.body);

      if (found) await accepted(id, submission, found);
      else await settle(id, submission, "unknown", copy.notesNotFound);
    },
  };

  return { notes, setApp: (value: AppSeam) => { app = value; } };
};

export type Notes = ReturnType<typeof notesFor>;

const formsOf = (notes: Notes, id: string): readonly Form[] => notes.entries().find(([key]) => key === id)?.[1].forms ?? [];

/** U7691a: the unfinished forms on items. */
export const unfinishedItems = (notes: Notes, id: string) => formsOf(notes, id).filter(isItem).filter(form => form.text.trim() !== "");

/** U7691a: the form kept on an item, the one that replaces note `replacing` when given. */
export const itemFormOf = (notes: Notes, id: string, item: Pick<Item, "kind" | "name">, replacing?: number) => formsOf(notes, id).find((form): form is ItemFormDraft => isItem(form) && form.item.kind === item.kind && form.item.name === item.name && form.replacing === (replacing ?? null));
