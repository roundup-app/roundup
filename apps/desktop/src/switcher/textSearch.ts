import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
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

type Phase =
  | { kind: "idle" }
  | { kind: "waiting"; query: string }
  | { kind: "searching"; query: string }
  | { kind: "found"; query: string; found: Found }
  | { kind: "failed"; query: string; cause: string };

/** U7707a, U7707c: the Daemon's text matches for the Switcher's query, asked once per query while the Switcher is open. A reply for an older query is dropped, never shown, even when it arrives last. Nothing here waits on the Daemon: the caller reads `hits` and the states as they change. */
export const createTextSearch = (app: Pick<ProjectCalls, "rpc">, query: () => string | null) => {
  const [phase, setPhase] = createSignal<Phase>({ kind: "idle" });
  let latest = 0;
  const trimmed = createMemo(() => query()?.trim() ?? "");

  const ask = (words: string): void => {
    const mine = ++latest;
    const current = () => mine === latest;

    setPhase({ kind: "waiting", query: words });
    const timer = setTimeout(() => { if (current()) setPhase({ kind: "searching", query: words }); }, QUIET_MS);

    app.rpc("search.find", { query: words }).then(
      found => { if (current()) setPhase({ kind: "found", query: words, found }); },
      (thrown: Error) => { if (current()) setPhase({ kind: "failed", query: words, cause: thrown.message }); },
    ).finally(() => clearTimeout(timer));
  };

  createEffect(trimmed, words => {
    if ([...words].length < MIN_QUERY) {
      latest += 1;
      setPhase({ kind: "idle" });
    } else ask(words);
  });

  onCleanup(() => { latest += 1; });


  const found = () => {
    const now = phase();

    return now.kind === "found" ? now.found : null;
  };

  return {
    hits: (): SearchHit[] => found()?.hits.slice(0, SHOWN_HITS) ?? [],
    more: () => found()?.more === true,
    /** The reply for the current query has not come in. */
    awaiting: () => {
      const now = phase().kind;

      return now === "waiting" || now === "searching";
    },
    searching: () => phase().kind === "searching",
    failure: () => {
      const now = phase();

      return now.kind === "failed" ? now.cause : null;
    },
    retry: () => {
      const now = phase();

      if (now.kind === "failed") ask(now.query);
    },
    dismiss: () => setPhase({ kind: "idle" }),
  };
};
