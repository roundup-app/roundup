import { storageCopy } from "./copy";
import { createSignal } from "solid-js";
import * as v from "valibot";
import { load } from "@tauri-apps/plugin-store";
import { labels } from "../sharedCopy";

const labelOf = (key: string) => String(labels.get(key.split(":")[1] ?? "") ?? labels.get("app-settings"));

const schemas = new Map<string, v.GenericSchema>();

/** Register the existing family parser before App initialization enumerates legacy keys. */
export const storageSchema = <T extends v.GenericSchema>(family: string, schema: T): T => {
  schemas.set(family, schema);

  return schema;
};

const familyOf = (key: string) => [...schemas.keys()].find(family => key === family || key.startsWith(`${family}:`));

const recordSchema = v.union([
  v.strictObject({ version: v.literal(1), value: v.unknown() }),
  v.strictObject({ version: v.literal(1), removed: v.literal(true) }),
]);

// This is a read view for synchronous construction, never an acknowledgement or a second store.
// Only the official plugin owns persistence; the isolated harness explicitly supplies its adapter.
let restored = new Map<string, unknown>();

let plugin: Awaited<ReturnType<typeof load>> | undefined;

let browser: Storage | undefined;

let initialized = false;

let writes: Promise<unknown> = Promise.resolve();

let adapterRevision = 0;

const [failures, setFailures] = createSignal<{ key: string; cause: string; retry: () => Promise<string | null> }[]>([]);

/** Recoverable pending operations, with full foreign causes; no draft contents are logged. */
export const storageProblems = failures;

const reopen = async () => {
  const previous = plugin;
  plugin = undefined;

  if (previous) await previous.close();
  const store = await load("work.json", { autoSave: false, defaults: {} });
  plugin = store;
  restored = new Map(await store.entries<unknown>());

  return store;
};

/** The isolated browser harness uses the same validated interface, with no native durability claim. */
export const useBrowserStorage = (adapter: Storage) => {
  adapterRevision++;
  browser = adapter;
  initialized = true;
  writes = Promise.resolve();
  setFailures([]);
  setRetained([]);
  setRecovery(null);
};

const quarantinePrefix = "recovery:";

const quarantineSchema = v.strictObject({ key: v.string(), bytes: v.string() });

const [retained, setRetained] = createSignal<v.InferOutput<typeof quarantineSchema>[]>([]);

const [recovery, setRecovery] = createSignal<{ key: string; continue: () => Promise<string | null> } | null>(null);

/** Exact retained records are available only to explicit recovery copy actions. */
export const retainedStorage = retained;

/** Only a captured invalid legacy record grants permission to continue without it. */
export const storageRecovery = recovery;

const invalidLegacy = (key: string, bytes: string): string => {
  let pending: Promise<string | null> | undefined;
  setRecovery({ key, continue: () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const store = await reopen();

        // Never let an earlier choice authorize removing a repaired or replaced record.
        if (window.localStorage.getItem(key) !== bytes) return initializeStorage();
        const name = quarantinePrefix + JSON.stringify([key, bytes]);
        await store.set(name, { key, bytes });
        await store.save();
        // Reopen independently of the plugin cache. Native save also verifies disk bytes.
        await reopen();
        const checked = v.safeParse(quarantineSchema, restored.get(name));

        if (!checked.success || checked.output.key !== key || checked.output.bytes !== bytes) return storageCopy.recoveryReadback;

        const selected = recovery();
        const failure = await initializeStorage();

        // A failed restart or cleanup still owns the same recoverable original.
        if (failure !== null && recovery() === null) setRecovery(selected);

        return failure;
      } catch (error) {
        return storageCopy.recoveryFailure(labelOf(key), error instanceof Error ? error.message : String(error));
      }
    })().finally(() => { pending = undefined; });

    return pending;
  } });

  return storageCopy.invalid(labelOf(key));
};

/** No editor is constructed before validation, acknowledged save and readback.
 * Recovery records live outside the family namespace and never become live values.
 */
export const initializeStorage = async (): Promise<string | null> => {
  setRecovery(null);

  try {
    browser = undefined;
    initialized = false;
    const store = await reopen();
    const quarantines = [...restored].flatMap(([key, value]) => key.startsWith(quarantinePrefix) ? [v.parse(quarantineSchema, value)] : []);
    setRetained(quarantines);
    const legacy: { key: string; bytes: string }[] = [];
    const candidates: [string, unknown][] = [];

    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      const family = key === null ? undefined : familyOf(key);

      if (key === null || family === undefined) continue;
      // A read failure has no known bytes and therefore grants no continuation.
      const bytes = window.localStorage.getItem(key);

      if (bytes === null) continue;

      if (quarantines.some(record => record.key === key && record.bytes === bytes)) {
        legacy.push({ key, bytes });
        continue;
      }

      let value: unknown;

      try { value = JSON.parse(bytes); } catch { return invalidLegacy(key, bytes); }

      const parsed = v.safeParse(schemas.get(family)!, value);

      if (!parsed.success) return invalidLegacy(key, bytes);
      legacy.push({ key, bytes });

      if (!restored.has(key)) candidates.push([key, { version: 1, value }]);
    }

    for (const [key, raw] of restored) {
      const family = familyOf(key);

      if (family === undefined) continue;
      const record = v.parse(recordSchema, raw);

      if ("value" in record) v.parse(schemas.get(family)!, record.value);
    }

    for (const [key, value] of candidates) await store.set(key, value);

    if (legacy.length > 0) await store.save();
    await reopen();

    for (const record of quarantines) {
      const name = quarantinePrefix + JSON.stringify([record.key, record.bytes]);
      const checked = v.safeParse(quarantineSchema, restored.get(name));

      if (!checked.success || checked.output.key !== record.key || checked.output.bytes !== record.bytes) return storageCopy.recoveryReadback;
    }

    for (const { key, bytes } of legacy) {
      if (window.localStorage.getItem(key) === bytes) window.localStorage.removeItem(key);
    }

    initialized = true;

    return null;
  } catch (error) {
    return storageCopy.restoreFailure(error instanceof Error ? error.message : String(error));
  }
};

type Restore<T> =
  | { status: "missing" }
  | { status: "restored"; value: T }
  | { status: "failed"; cause: "unreadable" | "invalid" };

/** onRetained runs after a successful write or retry, so views observe only acknowledged values. */
export const storedValue = <T>(key: string, schema: v.GenericSchema<unknown, T>, onRetained?: () => void) => {
  const restore = (): Restore<T> => {
    if (!initialized) return { status: "failed", cause: "unreadable" };

    try {
      let value: unknown;

      if (browser) {
        let bytes: string | null;

        try { bytes = browser.getItem(key); } catch { bytes = browser.getItem(key); }

        if (bytes === null) return { status: "missing" };

        try { value = JSON.parse(bytes); } catch { return { status: "failed", cause: "invalid" }; }
      } else {
        if (!restored.has(key)) return { status: "missing" };
        const record = v.safeParse(recordSchema, restored.get(key));

        if (!record.success) return { status: "failed", cause: "invalid" };

        if ("removed" in record.output) return { status: "missing" };
        value = structuredClone(record.output.value);
      }

      const parsed = v.safeParse(schema, value);

      return parsed.success ? { status: "restored", value: parsed.output } : { status: "failed", cause: "invalid" };
    } catch {
      return { status: "failed", cause: "unreadable" };
    }
  };

  const commit = (value: T | null, remove: boolean, expected?: T | null): Promise<string | null> => {
    const revision = adapterRevision;

    // Capture before queuing; a caller's later mutation must never alter an older save.
    let bytes: string;
    let record: string;

    try {
      bytes = JSON.stringify(value);

      if (!remove) v.parse(schema, JSON.parse(bytes));
      record = JSON.stringify(remove ? { version: 1, removed: true } : { version: 1, value: JSON.parse(bytes) });
    } catch (error) { return Promise.resolve((error instanceof Error ? error.message : String(error))); }

    const pending = writes.then(async () => {
      if (revision !== adapterRevision) return storageCopy.replaced;
      let base: T | null = expected ?? null;
      let failure: string | null = null;

      try {
        if (!initialized) throw new Error(storageCopy.notRestored);

        if (!browser) await reopen();
        const current = restore();

        if (current.status === "failed" && (current.cause === "unreadable" || expected !== undefined)) throw new Error(storageCopy.readFailure(current.cause));
        const saved = current.status === "restored" ? current.value : null;
        base = expected === undefined ? saved : expected;

        if (expected !== undefined && JSON.stringify(saved) !== JSON.stringify(expected)
          && JSON.stringify(saved) !== bytes) throw new Error(storageCopy.changed);

        if (browser) {
          for (let attempt = 0; ; attempt++) {
            try {
              if (remove) browser.removeItem(key); else browser.setItem(key, bytes);
              break;
            } catch (error) { if (attempt === 1) throw error; }
          }
        } else {
          if (!plugin) throw new Error(storageCopy.notRestored);
          await plugin.set(key, JSON.parse(record));
          await plugin.save();
          restored.set(key, JSON.parse(record));
        }
      } catch (error) { failure = (error instanceof Error ? error.message : String(error)); }

      if (revision !== adapterRevision) return failure;

      if (failure === null) onRetained?.();
      setFailures(previous => [
        ...previous.filter(entry => entry.key !== key),
        ...(failure === null ? [] : [{ key, cause: failure, retry: () => commit(remove ? null : v.parse(schema, JSON.parse(bytes)), remove, base) }]),
      ]);

      return failure;
    });

    writes = pending;

    return pending;
  };

  return {
    restore,
    clear: () => commit(null, true),
    read: (): T | null => {
      const result = restore();

      return result.status === "restored" ? result.value : null;
    },
    write: (value: T, expected?: T | null) => commit(value, false, expected),
    refresh: (): Promise<string | null> => {
      const pending = writes.then(async () => {
        if (browser) return null;

        try {
          await reopen();

          return null;
        } catch (error) { return (error instanceof Error ? error.message : String(error)); }
      });

      writes = pending;

      return pending;
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

const draftsSchema = storageSchema("roundup:drafts", v.pipe(
  v.strictObject({ version: v.literal(1), drafts: v.array(draftSchema) }),
  v.check(({ drafts }) => drafts.every((draft) => draft.policy === "ordinary")
    && new Set(drafts.map((draft) => draft.revision)).size === drafts.length),
));

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

type RetainedDraft = { draft: Draft; retained: Promise<DraftProblem | null> };

const sameDestination = (a: Destination, b: Destination) =>
  a.surface === b.surface && a.object === b.object && a.recipient === b.recipient;

/** One holder per open Project. Owners supply whole forms and original machine identities.
 * Reading/copying never submits, changes the current draft, or resumes autosave.
 * Credential drafts remain memory-only; vendor Terminal buffers must never enter this holder.
 * Values contain named scalar fields/string selections; editor documents remain exact source strings.
 * list()/problem() are reactive; list() returns independent copies, oldest first; the last draft for a destination is current.
 * submit() marks a snapshot before the owner sends; settle() requires that revision's actual outcome.
 * Unknown acceptance requires reconciliation by the owner, never another submit() here.
 * edit returns recoverable memory and a retained promise; submit awaits its retention result.
 * problem() reports retention and restore failures without claiming pending work durable.
 * retry() retries storage only. Owners render copy/retry/selected discard beside that problem.
 */
export const draftStorage = (project: string) => {
  const storage = storedValue(`roundup:drafts:${project}`, draftsSchema);
  const [version, setVersion] = createSignal(0);
  let drafts: Draft[] = [];
  const [editors, setEditors] = createSignal<Destination[]>([]);
  let problem: DraftProblem | null = null;
  let baseline = "";
  const schemas = new Map<string, v.GenericSchema>();
  let incompatible = false;
  const removed = new Set<string>();
  let retaining: Promise<unknown> = Promise.resolve();

  const validateSaved = (saved: Draft[]): boolean => {
    const invalid = saved.find((draft) => {
      const schema = schemas.get(draft.destination.surface);

      return schema !== undefined && !v.safeParse(schema, draft.value).success;
    });

    if (!invalid) return true;

    incompatible = true;
    problem = { project, destination: invalid.destination, revision: invalid.revision, operation: "restore", cause: "invalid" };

    return false;
  };

  const restore = () => {
    const result = storage.restore();

    if (result.status === "failed") {
      if (!incompatible) problem = { project, destination: null, revision: null, operation: "restore", cause: result.cause };
      setVersion((previous) => previous + 1);

      return false;
    }

    const saved = result.status === "restored" ? result.value.drafts : [];

    if (!validateSaved(saved)) {
      setVersion((previous) => previous + 1);

      return false;
    }

    incompatible = false;
    baseline = JSON.stringify(saved);

    for (const draft of saved) {
      if (draft.destination.surface === "rail-clear") removed.add(draft.revision);
    }

    const known = new Set(drafts.map((draft) => draft.revision));

    drafts = [...saved.filter((draft) => !known.has(draft.revision) && !removed.has(draft.revision)).map((draft): Draft => ({
      ...draft, status: draft.status === "pending" ? "unknown" : draft.status,
    })), ...drafts];

    return true;
  };

  restore();

  const persist = async (affected: Draft | null, ordinary: Draft[], discarded: string[]): Promise<DraftProblem | null> => {
    if (incompatible) return structuredClone(problem);

    // Never overwrite a record that failed parsing, or a different writer's work.
    const result = storage.restore();

    if (result.status === "failed") {
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "restore", cause: result.cause };

      return structuredClone(problem);
    }

    const saved = result.status === "restored" ? result.value.drafts : [];

    if (!validateSaved(saved)) return structuredClone(problem);

    if (JSON.stringify(saved) !== baseline) {
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "retain", cause: "changed" };

      return structuredClone(problem);
    }

    if (!validateSaved(ordinary)) return structuredClone(problem);

    const value = { version: 1 as const, drafts: ordinary };

    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 10 * 1024 * 1024) {
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "retain", cause: "capacity" };

      return structuredClone(problem);
    }

    const failure = await storage.write(value, result.status === "restored" ? result.value : null);

    if (failure !== null) {
      setFailures(previous => previous.map(entry => entry.key === `roundup:drafts:${project}`
        ? { ...entry, retry: async () => (await retry())?.cause ?? null } : entry));
      problem = { project, destination: affected?.destination ?? null, revision: affected?.revision ?? null, operation: "retain", cause: failure === storageCopy.changed ? "changed" : "write" };

      return structuredClone(problem);
    }

    baseline = JSON.stringify(v.parse(draftsSchema, value).drafts);

    for (const revision of discarded) removed.delete(revision);
    problem = null;

    return null;
  };

  const retain = (affected: Draft | null): Promise<DraftProblem | null> => {
    const ordinary = structuredClone(drafts.filter(draft => draft.policy === "ordinary"));
    const discarded = [...removed];

    const pending = retaining.then(() => persist(affected, ordinary, discarded)).then(failure => {
      setVersion(previous => previous + 1);

      return failure;
    });

    retaining = pending;
    // Edits are visible immediately; only the returned promise acknowledges retention.
    setVersion(previous => previous + 1);

    return pending;
  };

  const retry = async (): Promise<DraftProblem | null> => {
      await retaining;
      const failure = await storage.refresh();

      if (failure !== null) {
        problem = { project, destination: null, revision: null, operation: "restore", cause: "unreadable" };
        setVersion(previous => previous + 1);
        setFailures(previous => [...previous.filter(entry => entry.key !== `roundup:drafts:${project}`), {
          key: `roundup:drafts:${project}`, cause: failure, retry: async () => (await retry())?.cause ?? null,
        }]);

        return structuredClone(problem);
      }

      if ((problem?.operation === "restore" || problem?.cause === "changed") && !restore()) return structuredClone(problem);

      return retain(drafts.find((draft) => draft.revision === problem?.revision) ?? null);
  };

  // U350 retires these revisions without offering recovery or replay.
  if (removed.size > 0) void retain(null);

  return {
    /** Register the owning surface's form parser before capturing edits. Incompatible
     * stored forms block writes until an explicit retry parses the repaired record.
     * Registration reads storage only; it never restores autosave or submits work.
     */
    validate: (surface: string, schema: v.GenericSchema): DraftProblem | null => {
      schemas.set(surface, schema);
      const result = storage.restore();

      if (!incompatible && result.status === "restored") validateSaved(result.value.drafts);

      if (!incompatible) validateSaved(drafts.filter((draft) => draft.policy === "ordinary"));

      if (result.status === "failed" && !incompatible) {
        problem = { project, destination: null, revision: null, operation: "restore", cause: result.cause };
      }

      setVersion((previous) => previous + 1);

      return structuredClone(problem);
    },
    editor: (destination: Destination) => {
      setEditors(previous => [...previous, destination]);

      return () => setEditors(previous => previous.filter(entry => entry !== destination));
    },
    recoverable: (): Draft[] => {
      version();

      return structuredClone(drafts.filter(draft => draft.status !== "draft" || problem !== null || !editors().some(destination => sameDestination(destination, draft.destination))));
    },
    list: (): Draft[] => {
      version();

      return structuredClone(drafts);
    },
    problem: (): DraftProblem | null => {
      version();

      return structuredClone(problem);
    },
    /** Omitting replaces edits the destination's current drafts; a revision replaces only
     * that editable draft, and null starts a draft without consuming another editor's work.
     * Submitted revisions remain until acknowledgement or explicit discard.
     */
    edit: (target: Destination, value: Draft["value"], caret: Draft["selection"], policy: Draft["policy"], replaces?: string | null): RetainedDraft => {
      const draft: Draft = structuredClone({
        revision: crypto.randomUUID(), destination: target, value, selection: caret, policy, status: "draft",
      });

      const replaced = (previous: Draft) => previous.status === "draft" && sameDestination(previous.destination, target)
        && (replaces === undefined || previous.revision === replaces);

      for (const previous of drafts) {
        if (replaced(previous)) {
          removed.add(previous.revision);
        }
      }

      drafts = drafts.filter((previous) => !replaced(previous));
      drafts.push(draft);
      const retained = retain(draft);

      return { draft: structuredClone(draft), retained };
    },
    setSelection: async (revision: string, selection: Draft["selection"]): Promise<DraftProblem | null> => {
      const draft = drafts.find(entry => entry.revision === revision);

      if (!draft) return structuredClone(problem);
      draft.selection = structuredClone(selection);

      return retain(draft);
    },
    submit: async (revision: string): Promise<{ draft: Draft; problem: DraftProblem | null } | null> => {
      const draft = drafts.find((entry) => entry.revision === revision);

      if (!draft || (draft.status !== "draft" && draft.status !== "failed")) return null;

      draft.status = "pending";
      const snapshot = structuredClone(draft);
      const failure = await retain(draft);

      return { draft: snapshot, problem: failure };
    },
    settle: async (revision: string, outcome: "acknowledged" | "failed" | "unknown"): Promise<DraftProblem | null> => {
      const draft = drafts.find((entry) => entry.revision === revision);

      if (!draft || draft.status === "draft") return structuredClone(problem);

      if (outcome === "acknowledged") {
        removed.add(revision);
        drafts = drafts.filter((entry) => entry.revision !== revision);
      }
      else draft.status = outcome;

      return retain(draft);
    },
    discard: async (revision: string): Promise<DraftProblem | null> => {
      const draft = drafts.find((entry) => entry.revision === revision);

      if (!draft) return structuredClone(problem);

      removed.add(revision);
      drafts = drafts.filter((entry) => entry.revision !== revision);

      return retain(draft);
    },
    retry,
  };
};
