import { outcomeOf } from "../app/seam";
import { copy } from "./copy";
import { createSignal } from "solid-js";
import * as v from "valibot";
import { parse, stringify } from "flatted";
import { draftStorage } from "../state/storage";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Message } from "@contracts/message/Message";
import type { AppSeam } from "../app/seam";

const content = v.variant("kind", [
  v.strictObject({ kind: v.literal("absent"), revision: v.string() }),
  v.strictObject({ kind: v.literal("binary"), revision: v.string() }),
  v.strictObject({ kind: v.literal("text"), revision: v.string(), text: v.string() }),
]);

const comparison = v.strictObject({
  base: v.string(), oldPath: v.string(), newPath: v.string(),
  status: v.nullable(v.picklist(["added", "modified", "deleted", "renamed", "untracked"])), old: content, new: content,
});

const offset = v.pipe(v.number(), v.integer(), v.minValue(0));

const line = v.pipe(v.number(), v.integer(), v.minValue(1));

const caret = v.nullable(v.strictObject({ start: offset, end: offset, direction: v.picklist(["forward", "backward", "none"]) }));

const noteSchema = v.strictObject({
  id: line, revision: v.string(), comparison, side: v.picklist(["old", "new"]),
  start: line, end: line, source: v.string(), text: v.string(), selection: v.optional(caret),
});

const formSchema = v.strictObject({
  revision: v.string(), comparison, replacing: v.nullable(line),
  side: v.picklist(["old", "new"]), start: v.string(), end: v.string(), text: v.string(),
  selection: caret,
});

const submissionSchema = v.strictObject({
  revision: v.string(), notes: v.array(noteSchema), body: v.string(), previous: v.nullable(v.array(offset)),
  status: v.picklist(["pending", "unknown", "failed"]), text: v.string(),
});

const savedRecipientSchema = v.strictObject({ version: v.literal(1), notes: v.array(noteSchema), forms: v.array(formSchema), submissions: v.array(submissionSchema) });

const recipientSchema = v.strictObject({ ...savedRecipientSchema.entries, recovered: v.array(v.strictObject({ revision: v.string(), data: savedRecipientSchema })) });

export type Note = v.InferOutput<typeof noteSchema>;

export type NoteFormDraft = v.InferOutput<typeof formSchema>;

type Submission = v.InferOutput<typeof submissionSchema>;

type Recipient = v.InferOutput<typeof recipientSchema>;

/** Valibot checks the library graph without replacing shared comparison objects. */
const parseRecipient = (data: string): Recipient => {
  const value: unknown = parse(data);

  v.assert(recipientSchema, value);

  return value;
};

type Send = { kind: "idle"; text: string } | { kind: "failed"; text: string; submission: string; notes: readonly number[] | null } | { kind: "pending" } | { kind: "unknown"; submission: Submission; text: string };

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

const bodyOf = (notes: readonly Note[]) => JSON.stringify({
  description: copy.notesDescription,
  notes: notes.map(note => ({ "File:": { old: note.comparison.oldPath, new: note.comparison.newPath }, "Base:": note.comparison.base, "Content revisions:": { old: note.comparison.old.revision, new: note.comparison.new.revision }, "Lines:": `${note.side} ${note.start}-${note.end}`, "Selected source:": note.source, "User comment:": note.text })),
}, null, 2);

const createNotes = (firstApp: AppSeam, project: string, storage: ReturnType<typeof draftStorage>) => {
  let app = firstApp;
  const records = () => storage.list().filter(draft => draft.destination.surface === "changes" && draft.policy === "ordinary");
  const restored = new Map<string, Recipient>();
  const invalid = new Set<string>();
  const restoredRevisions = new Map<string, string>();
  let next = 0;

  const remember = (value: Recipient) => {
    for (const batch of [value, ...value.recovered.map(entry => entry.data)]) {
      for (const note of [...batch.notes, ...batch.submissions.flatMap(submission => submission.notes)]) next = Math.max(next, note.id);

      for (const form of batch.forms) next = Math.max(next, form.replacing ?? 0);
    }
  };

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
        remember(value);
      } catch { invalid.add(draft.revision); }
    }
  };

  load();
  const [all, setAll] = createSignal<ReadonlyMap<string, Recipient>>(restored);
  const [sends, setSends] = createSignal<ReadonlyMap<string, Send>>(new Map());
  const [problem, setProblem] = createSignal(storage.problem());
  const [invalidCount, setInvalidCount] = createSignal(invalid.size);
  const recipient = (id: string): Recipient => all().get(id) ?? { version: 1, notes: [], forms: [], submissions: [], recovered: [] };
  const list = (id: string): readonly Note[] => recipient(id).notes;

  const state = (id: string): Send => {
    const submission = recipient(id).submissions.find(value => value.status !== "failed");

    if (submission) return submission.status === "pending" ? { kind: "pending" } : { kind: "unknown", submission, text: submission.text };

    return sends().get(id) ?? { kind: "idle", text: "" };
  };

  const putState = (id: string, value: Send) => setSends(old => new Map(old).set(id, value));

  const clearItem = (id: string, note: number) => {
    const failed = sends().get(id);

    if (failed?.kind !== "failed" || failed.notes === null) return;
    const remaining = failed.notes.filter(value => value !== note);

    putState(id, remaining.length ? { ...failed, notes: remaining } : { kind: "idle", text: "" });
  };

  const retain = async (id: string, value: Recipient) => {
    const empty = !value.notes.length && !value.forms.length && !value.submissions.length && !value.recovered.length;

    setAll(old => {
      const next = new Map(old);

      if (empty) next.delete(id); else next.set(id, value);

      return next;
    });

    // Invalid records are recoverable evidence, never overwritten by a fresh edit.
    if (invalid.size) return;

    if (empty) {
      for (const draft of records()) if (draft.destination.surface === "changes" && draft.destination.recipient === id) setProblem(await storage.discard(draft.revision));
    } else setProblem(await storage.edit({ surface: "changes", object: id, recipient: id }, { data: stringify(value) }, null, "ordinary").retained);
  };

  const accepted = async (id: string, submission: Submission, message: Message) => {
    const revisions = new Set(submission.notes.map(note => note.revision));
    const current = recipient(id);

    await retain(id, { ...current, notes: current.notes.filter(note => !revisions.has(note.revision)), submissions: current.submissions.filter(value => value.revision !== submission.revision) });
    putState(id, { kind: "idle", text: message.status === "pending" ? copy.notesQueued : copy.notesAccepted(message.status) });
  };

  const settle = async (id: string, submission: Submission, status: "failed" | "unknown", text: string, item = true) => {
    const current = recipient(id);

    await retain(id, { ...current, submissions: current.submissions.map(value => value.revision === submission.revision ? { ...submission, status, text } : value) });

    if (status === "failed") putState(id, { kind: "failed", text, submission: submission.revision, notes: item ? submission.notes.map(note => note.id) : null });
  };

  const history = (connection: AppSeam, id: string) => reply(() => connection.rpc("message.list", { to: id, status: null }));

  const notes = {
    list, state,
    failure: (id: string) => {
      const value = sends().get(id);

      return value?.kind === "failed" ? value.text : null;
    },
    dismiss: (id: string) => { if (sends().get(id)?.kind === "failed") putState(id, { kind: "idle", text: "" }); },
    project,
    entries: () => [...all().entries()],
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

          remember(value);
          const current = all().get(id);

          if (!current) {
            setAll(old => new Map(old).set(id, { ...value, submissions: value.submissions.map(submission => submission.status === "pending" ? { ...submission, status: "unknown" } : submission) }));
          } else if (JSON.stringify(v.parse(recipientSchema, current)) !== JSON.stringify(v.parse(recipientSchema, value)) && !current.recovered.some(entry => entry.revision === draft.revision)) {
            setAll(old => new Map(old).set(id, { ...current, recovered: [...current.recovered, { revision: draft.revision, data: { version: value.version, notes: value.notes, forms: value.forms, submissions: value.submissions.map(submission => submission.status === "pending" ? { ...submission, status: "unknown", text: copy.notesNoReply } : submission) } }, ...value.recovered.filter(entry => !current.recovered.some(known => known.revision === entry.revision))] }));
          }
        } catch { invalid.add(draft.revision); }
      }

      setInvalidCount(invalid.size);

      if (!invalid.size) for (const [id, value] of all()) await retain(id, value);
    },
    invalid: () => { invalidCount();

      return records().filter(draft => invalid.has(draft.revision)).map(draft => {
        let preview: (Note | NoteFormDraft)[] = [];

        try {
          const row = v.nullable(v.union([noteSchema, formSchema]));
          const rows = v.fallback(v.array(v.fallback(row, null)), []);
          const result = v.parse(v.looseObject({ notes: rows, forms: rows }), parse(String(draft.value.data)));

          preview = [...result.notes, ...result.forms].filter(value => value !== null);
        } catch { /* Copy preserves even records without readable note fields. */ }

        return { ...draft, preview };
      }); },
    discardInvalid: async (revision: string) => {
      invalid.delete(revision);
      setInvalidCount(invalid.size);
      setProblem(await storage.discard(revision));

      if (!invalid.size) for (const [id, value] of all()) await retain(id, value);
    },
    form: (id: string, comparison: FileComparison, replacing?: number) => recipient(id).forms.find(form => form.replacing === (replacing ?? null) && form.comparison.newPath === comparison.newPath),
    editForm: (id: string, form: NoteFormDraft) => {
      const current = recipient(id);
      const previous = current.forms.find(value => value.revision === form.revision);

      // Native selection events can repeat after restoring the same caret; a no-op must not rebuild the editor.
      if (previous && previous.comparison === form.comparison && previous.replacing === form.replacing
        && previous.side === form.side && previous.start === form.start && previous.end === form.end && previous.text === form.text
        && previous.selection?.start === form.selection?.start && previous.selection?.end === form.selection?.end && previous.selection?.direction === form.selection?.direction) return;

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
      const failure = sends().get(id);

      if (failure?.kind === "failed" && failure.notes !== null && failure.submission === revision) putState(id, { kind: "idle", text: "" });

      for (const note of selected?.notes ?? []) if (!list(id).some(value => value.id === note.id)) clearItem(id, note.id);
    },
    save: async (id: string, note: Omit<Note, "id" | "revision">, replacing?: number, form?: string) => {
      const current = recipient(id);
      const values = current.notes;

      if (replacing === undefined && values.length >= 200) return false;
      const value = { ...note, id: replacing ?? ++next, revision: crypto.randomUUID() };
      const updated = values.some(old => old.id === replacing) ? values.map(old => old.id === replacing ? value : old) : [...values, value];
      await retain(id, { ...current, notes: updated, forms: current.forms.filter(value => value.revision !== form) });

      if (replacing !== undefined && !notes.problem()) clearItem(id, replacing);

      return true;
    },
    remove: async (id: string, note: number) => {
      await retain(id, { ...recipient(id), notes: list(id).filter(value => value.id !== note) });

      if (!notes.problem()) clearItem(id, note);
    },
    send: async (id: string) => {
      if (list(id).length === 0 || (state(id).kind === "pending" || state(id).kind === "unknown")) return;
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
