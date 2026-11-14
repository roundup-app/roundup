import { createMemo, createSignal } from "solid-js";
import * as v from "valibot";
import type { Applied } from "../app/pending";
import type { draftStorage } from "./storage";

type Drafts = ReturnType<typeof draftStorage>;

type Destination = Parameters<Drafts["edit"]>[0];

type Stored = Parameters<Drafts["edit"]>[1];

type Caret = Parameters<Drafts["edit"]>[2];

/** How long a sent revision waits for its reply before it settles unknown. */
const NO_REPLY_MS = 15_000;

/** `skipped`: nothing was sent (no draft, or a recovered one awaiting Save). */
export type Sent<R> = { kind: "applied"; result: R } | { kind: "refused"; error: Error } | { kind: "unknown" } | { kind: "skipped" };

const sameCaret = (a: Caret, b: Caret): boolean =>
  a === b || (a !== null && b !== null && a.start === b.start && a.end === b.end && a.direction === b.direction);

const sameValue = (a: Stored, b: Stored): boolean => {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every(key => {
    const left = a[key];
    const right = b[key];

    return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((item, index) => item === right[index]) : left === right;
  });
};

/** One unfinished-input field over a Project's drafts: keep, send, settle, discard. A surface holds no revision, fingerprint or caret of its own.
 * `from`: the retained draft the field reopens; without it, or once that revision is gone, the field follows the destination's newest. */
export const createDraftField = <Value extends Stored>(drafts: Drafts, destination: Destination, schema: v.GenericSchema<unknown, Value>, from?: { revision: string }) => {
  const [followed, follow] = createSignal(from?.revision);

  const latest = createMemo(() => {
    const own = drafts.list().filter(draft => draft.destination.surface === destination.surface
      && draft.destination.object === destination.object && draft.destination.recipient === destination.recipient);

    return own.find(draft => draft.revision === followed()) ?? own.at(-1);
  });

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

    // The same value is no new work: a recovered, sent or settled revision keeps its caret; the owner's open one takes the new caret.
    if (draft && sameValue(draft.value, next)) {
      if (draft.status === "draft" && !recovered() && !sameCaret(draft.selection, caret)) void drafts.setSelection(draft.revision, caret);

      return;
    }

    const { revision } = drafts.edit(destination, next, caret, "ordinary", draft?.status === "draft" ? draft.revision : null).draft;
    own(revision);
    follow(revision);
  };

  /** The caret moved over an unchanged value: the followed draft keeps it, whatever its status. */
  const select = (caret: Caret) => {
    const draft = latest();

    if (draft && !sameCaret(draft.selection, caret)) void drafts.setSelection(draft.revision, caret);
  };

  /** The owner leaves the recovered state. */
  const save = () => {
    const draft = latest();

    if (draft) own(draft.revision);
  };

  /** `call` makes the change through `applying` (app/pending.ts), so the field reads its outcome unwrapped once. */
  const send = async <R>(call: () => Promise<Applied<R>>): Promise<Sent<R>> => {
    const draft = latest();

    if (!draft || recovered()) return { kind: "skipped" };
    const submitted = await drafts.submit(draft.revision);

    if (!submitted) return { kind: "skipped" };
    const { revision } = submitted.draft;

    // The reply resumes the caller through one promise: no race or extra wrapper delays it.
    const reply = await new Promise<Applied<R> | null>(resolve => {
      const timer = setTimeout(() => resolve(null), NO_REPLY_MS);

      void call().then(applied => {
        clearTimeout(timer);
        resolve(applied);
      });
    });

    // The store consumes exactly this revision at once, and a newer one keeps its own entry; retention reports its own problem.
    void drafts.settle(revision, reply?.kind === "applied" ? "acknowledged" : reply?.kind === "refused" ? "failed" : "unknown");
    const outcome: Sent<R> = reply === null ? { kind: "unknown" } : reply.kind === "applied" ? { kind: "applied", result: reply.value } : { kind: "refused", error: reply.error };

    return outcome;
  };

  const discard = () => {
    const draft = latest();

    return draft ? drafts.discard(draft.revision) : Promise.resolve(null);
  };

  /** The draft the field follows, read-only: its status and identity for the surface's checks. */
  return { draft: latest, value, recovered, keep, select, save, send, discard };
};
