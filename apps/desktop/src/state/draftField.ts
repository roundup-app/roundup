import { createMemo, createSignal } from "solid-js";
import * as v from "valibot";
import type { draftStorage } from "./storage";

type Drafts = ReturnType<typeof draftStorage>;

type Destination = Parameters<Drafts["edit"]>[0];

type Stored = Parameters<Drafts["edit"]>[1];

type Caret = Parameters<Drafts["edit"]>[2];

/** How long a sent revision waits for its reply before it settles unknown. */
const NO_REPLY_MS = 15_000;

/** `skipped`: nothing was sent (no draft, or a recovered one awaiting Save). */
export type Sent<R> = { kind: "applied"; result: R } | { kind: "refused"; error: Error } | { kind: "unknown" } | { kind: "skipped" };

const sameValue = (a: Stored, b: Stored): boolean => {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every(key => {
    const left = a[key];
    const right = b[key];

    return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((item, index) => item === right[index]) : left === right;
  });
};

/** One unfinished-input field over a Project's drafts: keep, send, settle, discard. A surface holds no revision, fingerprint or caret of its own. */
export const createDraftField = <Value extends Stored>(drafts: Drafts, destination: Destination, schema: v.GenericSchema<Value>) => {
  const latest = createMemo(() => drafts.list().findLast(draft => draft.destination.surface === destination.surface
    && draft.destination.object === destination.object && draft.destination.recipient === destination.recipient));

  const value = createMemo(() => v.safeParse(schema, latest()?.value));

  // A draft found at creation is recovered; typing or an explicit save makes the owner's revisions its own.
  const [owned, setOwned] = createSignal<ReadonlySet<string>>(new Set<string>());

  const recovered = () => {
    const draft = latest();

    return draft !== undefined && !owned().has(draft.revision);
  };

  const own = (revision: string) => setOwned(previous => new Set(previous).add(revision));

  const keep = (next: Value, caret: Caret) => {
    const draft = latest();

    if (draft?.status === "draft" && sameValue(draft.value, next)) {
      if (JSON.stringify(draft.selection) !== JSON.stringify(caret)) void drafts.setSelection(draft.revision, caret);

      return;
    }

    own(drafts.edit(destination, next, caret, "ordinary", draft?.status === "draft" ? draft.revision : null).draft.revision);
  };

  /** The owner leaves the recovered state. */
  const save = () => {
    const draft = latest();

    if (draft) own(draft.revision);
  };

  const send = async <R>(call: () => Promise<R>): Promise<Sent<R>> => {
    const draft = latest();

    if (!draft || recovered()) return { kind: "skipped" };
    const submitted = await drafts.submit(draft.revision);

    if (!submitted) return { kind: "skipped" };
    const { revision } = submitted.draft;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const silence = new Promise<{ kind: "unknown" }>(resolve => { timer = setTimeout(() => resolve({ kind: "unknown" }), NO_REPLY_MS); });

    const reply = (async (): Promise<Sent<R>> => {
      try { return { kind: "applied", result: await call() }; }
      catch (error) { return { kind: "refused", error: error instanceof Error ? error : new Error(String(error)) }; }
    })();

    const outcome = await Promise.race([reply, silence]);
    clearTimeout(timer);
    // The store consumes exactly this revision; a newer one keeps its own entry.
    await drafts.settle(revision, outcome.kind === "applied" ? "acknowledged" : outcome.kind === "refused" ? "failed" : "unknown");

    return outcome;
  };

  const discard = () => {
    const draft = latest();

    return draft ? drafts.discard(draft.revision) : Promise.resolve(null);
  };

  return { value, recovered, keep, save, send, discard };
};
