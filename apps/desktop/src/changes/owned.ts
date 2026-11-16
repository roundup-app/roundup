import { createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type { OwnedGroup } from "@contracts/agent/OwnedGroup";
import type { AppSeam } from "../app/seam";
import type { Events } from "../app/events";
import { failureOf } from "../app/failureOf";

export type OwnedRead = { failure: null; groups: OwnedGroup[] } | { failure: string };

/** The tools whose finished call writes a file, for every adapter (U7186a, U7186c). */
const WRITING = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** U7186c: what each Agent owns, read on first sight, again on a file-writing tool call and when a turn ends, and on no timer. */
export const createOwnedChanges = (app: AppSeam, events: Events, daemonExit: Accessor<unknown>) => {
  type Cell = [Accessor<OwnedRead | undefined>, Setter<OwnedRead | undefined>];

  const reads = new Map<string, Cell>();
  const generation = new Map<string, number>();

  const cell = (id: string) => {
    const found = reads.get(id);

    if (found) return found;
    const [get, set] = createSignal<OwnedRead | undefined>(undefined);
    const made: Cell = [get, set];

    reads.set(id, made);

    return made;
  };

  const refresh = async (id: string): Promise<OwnedRead | undefined> => {
    if (daemonExit()) return undefined;
    const request = (generation.get(id) ?? 0) + 1;

    generation.set(id, request);
    let groups: OwnedGroup[] = [];
    const failure = await failureOf(async () => { groups = (await app.rpc("agent.ownedChanges", { id })).groups; });

    if (generation.get(id) !== request) return undefined;
    const next: OwnedRead = failure === null ? { failure, groups } : { failure };

    cell(id)[1](next);

    return next;
  };

  const wanted = new Map<string, number>();

  const stop = events.subscribe(event => {
    if (event.name === "agent.toolCall" && WRITING.has(event.data.call.tool) && event.data.call.state !== "running") { if (wanted.has(event.data.id)) void refresh(event.data.id); }
    else if (event.name === "agent.status" && ["done", "idle", "error"].includes(event.data.status.kind) && wanted.has(event.data.id)) void refresh(event.data.id);
  });

  onCleanup(stop);

  return {
    /** Undefined until the first read ends: loading is never a zero. */
    read: (id: string): OwnedRead | undefined => cell(id)[0](),
    refresh,
    /** A row calls this while it shows: the Agent's first read starts and its events refresh it. */
    watch: (id: string) => {
      wanted.set(id, (wanted.get(id) ?? 0) + 1);

      if (wanted.get(id) === 1) untrack(() => { if (cell(id)[0]() === undefined) void refresh(id); });
      onCleanup(() => { const left = (wanted.get(id) ?? 1) - 1;

 if (left <= 0) wanted.delete(id); else wanted.set(id, left); });
    },
  };
};

/** The files an Agent owns across its groups; a file in two groups counts twice. */
export const ownedCount = (read: OwnedRead | undefined): number => read?.failure === null ? read.groups.reduce((sum, group) => sum + group.files.length, 0) : 0;
