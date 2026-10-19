import { copy } from "../copy";
import { createSignal } from "solid-js";
import * as v from "valibot";
import { draftStorage } from "../state/storage";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Message } from "@contracts/message/Message";
import { RpcError, INTERNAL_CODE } from "../app/seam";
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

const recipientSchema = v.strictObject({ ...savedRecipientSchema.entries, recovered: v.optional(v.array(v.strictObject({ revision: v.string(), data: savedRecipientSchema })), []) });

export type Note = v.InferOutput<typeof noteSchema>;

export type NoteFormDraft = v.InferOutput<typeof formSchema>;

type Submission = v.InferOutput<typeof submissionSchema>;

type Recipient = v.InferOutput<typeof recipientSchema>;

type Send = { kind: "idle" | "failed"; text: string } | { kind: "pending" } | { kind: "unknown"; submission: Submission; text: string };

const stores = new WeakMap<AppSeam["rpc"], Map<string, ReturnType<typeof createNotes>>>();

/** Project path scopes durable drafts; the RPC identity shares live edits across inspection mounts. */
export const notesFor = (app: AppSeam, project: string) => {
  let projects = stores.get(app.rpc);

  if (!projects) { projects = new Map(); stores.set(app.rpc, projects); }

  let notes = projects.get(project);

  if (!notes) { notes = createNotes(app, project); projects.set(project, notes); }

  return notes;
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

    return { kind: error instanceof RpcError && error.code !== INTERNAL_CODE ? "failed" : "unknown", text: error.message };
  } finally { clearTimeout(timer); }
};

const bodyOf = (notes: readonly Note[]) => JSON.stringify({
  description: copy.notesDescription,
  notes: notes.map(note => ({ "File:": { old: note.comparison.oldPath, new: note.comparison.newPath }, "Base:": note.comparison.base, "Content revisions:": { old: note.comparison.old.revision, new: note.comparison.new.revision }, "Lines:": `${note.side} ${note.start}-${note.end}`, "Selected source:": note.source, "User comment:": note.text })),
}, null, 2);

const createNotes = (app: AppSeam, project: string) => {
  const storage = draftStorage(project);
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
    for (const draft of storage.list()) {
      if (draft.destination.surface !== "changes") continue;
      const id = draft.destination.recipient;

      try {
        const value = v.parse(recipientSchema, JSON.parse(String(draft.value.data)));

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

  const retain = (id: string, value: Recipient) => {
    const empty = !value.notes.length && !value.forms.length && !value.submissions.length && !value.recovered.length;

    setAll(old => {
      const next = new Map(old);

      if (empty) next.delete(id); else next.set(id, value);

      return next;
    });

    // Invalid records are recoverable evidence, never overwritten by a fresh edit.
    if (invalid.size) return;

    if (empty) {
      for (const draft of storage.list()) if (draft.destination.surface === "changes" && draft.destination.recipient === id) setProblem(storage.discard(draft.revision));
    } else setProblem(storage.edit({ surface: "changes", object: id, recipient: id }, { data: JSON.stringify(value) }, null, "ordinary").problem);
  };

  const accepted = (id: string, submission: Submission, message: Message) => {
    const revisions = new Set(submission.notes.map(note => note.revision));
    const current = recipient(id);

    retain(id, { ...current, notes: current.notes.filter(note => !revisions.has(note.revision)), submissions: current.submissions.filter(value => value.revision !== submission.revision) });
    putState(id, { kind: "idle", text: message.status === "held" ? copy.notesHeld : message.status === "pending" ? copy.notesQueued : copy.notesAccepted(message.status) });
  };

  const settle = (id: string, submission: Submission, status: "failed" | "unknown", text: string) => {
    const current = recipient(id);

    retain(id, { ...current, submissions: current.submissions.map(value => value.revision === submission.revision ? { ...submission, status, text } : value) });

    if (status === "failed") putState(id, { kind: "failed", text });
  };

  const history = (id: string) => reply(() => app.rpc("message.list", { to: id, status: null }));

  return {
    list, state,
    project,
    entries: () => [...all().entries()],
    problem: () => invalidCount() ? copy.notesRestoreFailed(project) : problem() ? copy.notesRetentionFailed(project, problem()?.operation ?? "retain", problem()?.cause ?? "write") : null,
    copy: () => JSON.stringify({ project, drafts: storage.list(), memory: [...all()] }, null, 2),
    retry: () => {
      setProblem(storage.retry());

      // A recovered read can reveal older work alongside newer memory. Keep both, with no implicit merge or send.
      const saved = storage.list();

      for (const draft of saved) {
        if (draft.destination.surface !== "changes" || draft.destination.recipient === null) continue;
        const id = draft.destination.recipient;

        if (draft.destination.object !== id) { invalid.add(draft.revision); continue; }

        try {
          const value = v.parse(recipientSchema, JSON.parse(String(draft.value.data)));

          remember(value);
          const current = all().get(id);

          if (!current) {
            setAll(old => new Map(old).set(id, { ...value, submissions: value.submissions.map(submission => submission.status === "pending" ? { ...submission, status: "unknown" } : submission) }));
          } else if (JSON.stringify(v.parse(recipientSchema, current)) !== JSON.stringify(value) && !current.recovered.some(entry => entry.revision === draft.revision)) {
            setAll(old => new Map(old).set(id, { ...current, recovered: [...current.recovered, { revision: draft.revision, data: { version: value.version, notes: value.notes, forms: value.forms, submissions: value.submissions.map(submission => submission.status === "pending" ? { ...submission, status: "unknown", text: copy.notesNoReply } : submission) } }, ...value.recovered.filter(entry => !current.recovered.some(known => known.revision === entry.revision))] }));
          }
        } catch { invalid.add(draft.revision); }
      }

      setInvalidCount(invalid.size);

      if (!invalid.size) for (const [id, value] of all()) retain(id, value);
    },
    invalid: () => { invalidCount();

      return storage.list().filter(draft => invalid.has(draft.revision)); },
    discardInvalid: (revision: string) => {
      invalid.delete(revision);
      setInvalidCount(invalid.size);
      setProblem(storage.discard(revision));

      if (!invalid.size) for (const [id, value] of all()) retain(id, value);
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
    discardForm: (id: string, revision: string) => {
      const current = recipient(id);

      retain(id, { ...current, forms: current.forms.filter(form => form.revision !== revision) });
    },
    discardRecovered: (id: string, revision: string) => {
      const current = recipient(id);

      retain(id, { ...current, recovered: current.recovered.filter(value => value.revision !== revision) });
    },
    discardSubmission: (id: string, revision: string) => {
      const current = recipient(id);

      const selected = current.submissions.find(value => value.revision === revision);
      const revisions = new Set(selected?.notes.map(note => note.revision));

      retain(id, { ...current, notes: current.notes.filter(note => !revisions.has(note.revision)), submissions: current.submissions.filter(value => value.revision !== revision) });
    },
    save: (id: string, note: Omit<Note, "id" | "revision">, replacing?: number, form?: string) => {
      const current = recipient(id);
      const values = current.notes;

      if (replacing === undefined && values.length >= 200) return false;
      const value = { ...note, id: replacing ?? ++next, revision: crypto.randomUUID() };
      const updated = values.some(old => old.id === replacing) ? values.map(old => old.id === replacing ? value : old) : [...values, value];
      retain(id, { ...current, notes: updated, forms: current.forms.filter(value => value.revision !== form) });

      return true;
    },
    remove: (id: string, note: number) => retain(id, { ...recipient(id), notes: list(id).filter(value => value.id !== note) }),
    send: async (id: string) => {
      if (list(id).length === 0 || (state(id).kind === "pending" || state(id).kind === "unknown")) return;
      const notes = [...list(id)];
      const submission: Submission = { revision: crypto.randomUUID(), notes, body: bodyOf(notes), previous: null, status: "pending", text: "" };
      retain(id, { ...recipient(id), submissions: [...recipient(id).submissions, submission] });
      const prior = await history(id);

      if (prior.kind !== "ok") {
        settle(id, submission, "failed", prior.text);

        return;
      }

      submission.previous = prior.value.map(message => message.id);
      retain(id, { ...recipient(id), submissions: recipient(id).submissions.map(value => value.revision === submission.revision ? { ...submission } : value) });
      const result = await reply(() => app.rpc("message.send", { to: id, kind: "note", body: submission.body, replyTo: null }));

      if (result.kind === "ok") accepted(id, submission, result.value);
      else settle(id, submission, result.kind, result.kind === "unknown" ? copy.notesUnknown(result.text) : result.text);
    },
    reconcile: async (id: string) => {
      const current = state(id);

      if (current.kind !== "unknown") return;
      const submission = current.submission;
      const result = await history(id);

      if (result.kind !== "ok") return;

      // With no baseline, reload interrupted the read before any send could start.
      if (submission.previous === null) {
        settle(id, submission, "failed", copy.notesNotSent);

        return;
      }

      const previous = submission.previous;
      const found = result.value.find(message => !previous.includes(message.id) && message.from.kind === "user" && message.from.id === "you" && message.to === id && message.kind === "note" && message.body === submission.body);

      if (found) accepted(id, submission, found);
      else settle(id, submission, "unknown", copy.notesNotFound);
    },
  };
};

export type Notes = ReturnType<typeof notesFor>;
