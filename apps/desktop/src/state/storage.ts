import * as v from "valibot";

type Restore<T> =
  | { status: "missing" }
  | { status: "restored"; value: T }
  | { status: "failed"; cause: "unreadable" | "invalid" };

export const storedValue = <T>(key: string, schema: v.GenericSchema<unknown, T>) => {
  const restore = (): Restore<T> => {
    let value: string | null;

    try { value = window.localStorage.getItem(key); } catch {
      return { status: "failed", cause: "unreadable" };
    }

    if (value === null) return { status: "missing" };

    try {
      const parsed = v.safeParse(schema, JSON.parse(value));

      return parsed.success ? { status: "restored", value: parsed.output } : { status: "failed", cause: "invalid" };
    } catch {
      return { status: "failed", cause: "invalid" };
    }
  };

  return {
    restore,
    read: (): T | null => {
      const result = restore();

      return result.status === "restored" ? result.value : null;
    },
    write: (value: T): string | null => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));

        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  };
};

const draftValue = v.record(v.string(), v.union([
  v.string(), v.number(), v.boolean(), v.null(), v.array(v.string()),
]));

const destination = v.strictObject({ surface: v.string(), object: v.string(), recipient: v.nullable(v.string()) });

const selection = v.nullable(v.strictObject({
  start: v.pipe(v.number(), v.integer(), v.minValue(0)),
  end: v.pipe(v.number(), v.integer(), v.minValue(0)),
  direction: v.picklist(["forward", "backward", "none"]),
}));

const draftSchema = v.strictObject({
  revision: v.string(),
  destination,
  value: draftValue,
  selection,
  status: v.picklist(["draft", "pending", "unknown", "failed"]),
  policy: v.picklist(["ordinary", "credential"]),
});

const draftsSchema = v.pipe(
  v.strictObject({ version: v.literal(1), drafts: v.array(draftSchema) }),
  v.check(({ drafts }) => drafts.every((draft) => draft.policy === "ordinary")
    && new Set(drafts.map((draft) => draft.revision)).size === drafts.length),
);

type Draft = v.InferOutput<typeof draftSchema>;

type Destination = Draft["destination"];

type DraftProblem = {
  project: string;
  destination: Destination | null;
  revision: string | null;
} & (
  | { operation: "restore"; cause: "unreadable" | "invalid" }
  | { operation: "retain"; cause: "capacity" | "write" | "changed" }
);

type RetainedDraft = { draft: Draft; problem: DraftProblem | null };

const sameDestination = (a: Destination, b: Destination) =>
  a.surface === b.surface && a.object === b.object && a.recipient === b.recipient;

/** One holder per open Project. Owners supply whole forms and original machine identities.
 * Reading/copying never submits, changes the current draft, or resumes autosave.
 * Credential drafts remain memory-only; vendor Terminal buffers must never enter this holder.
 * Values contain named scalar fields/string selections; editor documents remain exact source strings.
 * list() returns independent copies, oldest first; the last draft for a destination is current.
 * submit() marks a snapshot before the owner sends; settle() requires that revision's actual outcome.
 * Unknown acceptance requires reconciliation by the owner, never another submit() here.
 * edit/submit return recoverable memory plus the retention result; problem() also reports restore failure.
 * retry() retries storage only. Owners render copy/retry/selected discard beside that problem.
 */
export const draftStorage = (project: string) => {
  const storage = storedValue(`roundup:drafts:${project}`, draftsSchema);
  let drafts: Draft[] = [];
  let problem: DraftProblem | null = null;
  let baseline = "";
  const removed = new Set<string>();
  let durable = new Set<string>();

  const restore = () => {
    const result = storage.restore();

    if (result.status === "failed") {
      problem = { project, destination: null, revision: null, operation: "restore", cause: result.cause };

      return false;
    }

    const saved = result.status === "restored" ? result.value.drafts : [];

    baseline = JSON.stringify(saved);
    durable = new Set(saved.map((draft) => draft.revision));
    const known = new Set(drafts.map((draft) => draft.revision));

    drafts = [...saved.filter((draft) => !known.has(draft.revision) && !removed.has(draft.revision)).map((draft): Draft => ({
      ...draft, status: draft.status === "pending" ? "unknown" : draft.status,
    })), ...drafts];

    return true;
  };

  restore();

  const retain = (affected: Draft | null): DraftProblem | null => {
    // Never overwrite a record that failed parsing, or a different writer's work.
    const result = storage.restore();

    if (result.status === "failed") {
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "restore", cause: result.cause };

      return structuredClone(problem);
    }

    const saved = result.status === "restored" ? result.value.drafts : [];

    if (JSON.stringify(saved) !== baseline) {
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "retain", cause: "changed" };

      return structuredClone(problem);
    }

    const ordinary = drafts.filter((draft) => draft.policy === "ordinary");
    const value = { version: 1 as const, drafts: ordinary };

    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 10 * 1024 * 1024) {
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "retain", cause: "capacity" };

      return structuredClone(problem);
    }

    if (storage.write(value) !== null) {
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "retain", cause: "write" };

      return structuredClone(problem);
    }

    baseline = JSON.stringify(v.parse(draftsSchema, value).drafts);
    durable = new Set(ordinary.map((draft) => draft.revision));
    removed.clear();
    problem = null;

    return null;
  };

  return {
    list: (): Draft[] => structuredClone(drafts),
    problem: (): DraftProblem | null => structuredClone(problem),
    edit: (target: Destination, value: Draft["value"], caret: Draft["selection"], policy: Draft["policy"]): RetainedDraft => {
      const draft: Draft = structuredClone({
        revision: crypto.randomUUID(), destination: target, value, selection: caret, policy, status: "draft",
      });

      for (const previous of drafts) {
        if (previous.status === "draft" && sameDestination(previous.destination, target) && durable.has(previous.revision)) {
          removed.add(previous.revision);
        }
      }

      drafts = drafts.filter((previous) => previous.status !== "draft" || !sameDestination(previous.destination, target));
      drafts.push(draft);
      const failure = retain(draft);

      return { draft: structuredClone(draft), problem: failure };
    },
    submit: (revision: string): RetainedDraft | null => {
      const draft = drafts.find((entry) => entry.revision === revision);

      if (!draft || (draft.status !== "draft" && draft.status !== "failed")) return null;

      draft.status = "pending";
      const failure = retain(draft);

      return { draft: structuredClone(draft), problem: failure };
    },
    settle: (revision: string, outcome: "acknowledged" | "failed" | "unknown"): DraftProblem | null => {
      const draft = drafts.find((entry) => entry.revision === revision);

      if (!draft || draft.status === "draft") return structuredClone(problem);

      if (outcome === "acknowledged") {
        if (durable.has(revision)) removed.add(revision);
        drafts = drafts.filter((entry) => entry.revision !== revision);
      }
      else draft.status = outcome;

      return retain(draft);
    },
    discard: (revision: string): DraftProblem | null => {
      const draft = drafts.find((entry) => entry.revision === revision);

      if (!draft) return structuredClone(problem);

      if (durable.has(revision)) removed.add(revision);
      drafts = drafts.filter((entry) => entry.revision !== revision);

      return retain(draft);
    },
    retry: (): DraftProblem | null => {
      if ((problem?.operation === "restore" || problem?.cause === "changed") && !restore()) return structuredClone(problem);

      return retain(drafts.find((draft) => draft.revision === problem?.revision) ?? null);
    },
  };
};
