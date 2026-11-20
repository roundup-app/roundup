import { createEffect, createSignal, onCleanup } from "solid-js";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import { copy } from "./copy";
import { createLate } from "./late";

/** U7693c: what the header chip says; `current` and `none` draw nothing, so they are not states. */
export type RemoteChip =
  | { kind: "checking" }
  | { kind: "moved" }
  | { kind: "fetching" }
  | { kind: "fetched"; commits: number }
  | { kind: "failed"; cause: string };

/** What the chip says for its state: the words only, never the cause. */
export const wordsOf = (chip: RemoteChip): string => {
  switch (chip.kind) {
    case "checking": return copy.checkingRemote;
    case "moved": return copy.remoteMoved;
    case "fetching": return "";
    case "fetched": return copy.fetched(chip.commits);
    case "failed": return `${copy.remoteUnreachable}:`;
  }
};

/** The cause a failed chip names in full; nothing for another state. */
export const causeOf = (chip: RemoteChip): string => chip.kind === "failed" ? chip.cause : "";

/**
 * U7693c: the Agent's remote main, read once after the view's first state draws and fetched only by `fetch`. The view for an
 * Agent is mounted per Agent, so one answer never reaches another's header; `fetched` runs after a fetch succeeds.
 */
export const createRemoteMain = (app: AppSeam, id: string, ready: () => boolean, fetched: () => void) => {
  const [state, setState] = createSignal<RemoteChip | null>(null);
  const late = createLate(() => state()?.kind === "checking");
  let open = true;
  let again: "read" | "fetch" = "read";
  let started = false;

  onCleanup(() => { open = false; });

  const run = async (call: "read" | "fetch") => {
    again = call;
    setState({ kind: call === "read" ? "checking" : "fetching" });
    let next: RemoteChip | null = null;

    const cause = await failureOf(async () => {
      if (call === "read") next = (await app.rpc("agent.remoteMain", { id })).kind === "moved" ? { kind: "moved" } : null;
      else next = { kind: "fetched", commits: (await app.rpc("agent.fetchRemoteMain", { id })).commits };
    });

    if (!open) return;
    setState(cause === null ? next : { kind: "failed", cause });

    if (cause === null && call === "fetch") fetched();
  };

  createEffect(ready, settled => {
    if (!settled || started) return;
    started = true;
    void run("read");
  });

  const chip = (): RemoteChip | null => {
    const now = state();

    return now?.kind === "checking" && !late() ? null : now;
  };

  return { chip, fetch: () => { void run("fetch"); }, retry: () => { void run(again); } };
};
