import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import type { Found } from "@contracts/search/Found";
import type { SearchHit } from "@contracts/search/SearchHit";
import type { ProjectCalls } from "../app/seam";

/** U7707a: a query shorter than this, trimmed, makes no call. */
export const MIN_QUERY = 2;

/** U7707d: the most hits the group shows. */
export const SHOWN_HITS = 20;

/** U7707c: how long a reply may take before the group says `Searching`. */
const QUIET_MS = 150;

export const foundValue = (hit: SearchHit): string => `found:${hit.kind}:${hit.id}`;

/** The reply to the query asked under `key`: the query and the retry that asked it. */
type Answer = { key: string } & ({ found: Found } | { cause: string });

/** U7707a, U7707c: the Daemon's text matches for the Switcher's query, asked once per query while the Switcher is open. A reply for an older query is dropped, never shown, even when it arrives last. Nothing here waits on the Daemon: the caller reads `hits` and the states as they change. */
export const createTextSearch = (app: Pick<ProjectCalls, "rpc">, query: () => string | null) => {
  const trimmed = createMemo(() => query()?.trim() ?? "");
  const asking = () => [...trimmed()].length >= MIN_QUERY;
  const [tries, setTries] = createSignal("");
  const key = createMemo(() => `${tries()}:${trimmed()}`);
  const [answer, setAnswer] = createSignal<Answer | null>(null);
  const [dismissed, setDismissed] = createSignal("");
  const [slow, setSlow] = createSignal("");

  createEffect(key, asked => {
    if (!asking()) return;

    const words = untrack(trimmed);
    const timer = setTimeout(() => { setSlow(asked); }, QUIET_MS);
    const settle = (reply: Answer): void => { if (untrack(key) === asked) setAnswer(reply); };

    app.rpc("search.find", { query: words }).then(
      found => { settle({ key: asked, found }); },
      (thrown: Error) => { settle({ key: asked, cause: thrown.message }); },
    ).finally(() => { clearTimeout(timer); });

    return () => { clearTimeout(timer); };
  });

  /** The reply for the query now typed, when it has come in. */
  const current = (): Answer | null => {
    const reply = answer();

    return asking() && reply?.key === key() ? reply : null;
  };

  const found = () => {
    const reply = current();

    return reply && "found" in reply ? reply.found : null;
  };

  const awaiting = () => asking() && current() === null;

  return {
    hits: (): SearchHit[] => found()?.hits.slice(0, SHOWN_HITS) ?? [],
    more: () => found()?.more === true,
    awaiting,
    searching: () => awaiting() && slow() === key(),
    failure: () => {
      const reply = current();

      return reply && "cause" in reply && dismissed() !== reply.key ? reply.cause : null;
    },
    retry: () => { setDismissed(""); setTries(crypto.randomUUID()); },
    dismiss: () => { setDismissed(key()); },
  };
};
