import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { ReservedLine } from "../ink/ReservedLine";
import { KeyChip } from "../keys/KeyChip";
import type { KeyText } from "../keys/chords";
import { attentionOrder } from "../rail/attention";
import { useConnectedProject } from "../state/connectedProject";
import type { KeyScope } from "../keys/registry";
import { finishedSince, type Finished } from "./changes";
import { copy } from "./copy";
import { openDeliverable } from "./openDeliverable";
import { AskRows, unresolvedParts } from "./AskRows";

const arrows = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const actions = [...event.currentTarget.querySelectorAll<HTMLElement>("button.change-action")];
  // SAFETY: a keydown target is an Element; indexOf returns -1 for a non-action and then lands on no row.
  const from = actions.indexOf(event.target as HTMLElement);
  const next = actions[from + (event.key === "ArrowDown" ? 1 : -1)];

  if (next) {
    event.preventDefault();
    next.focus();
  }
};

// SAFETY: "⏎" is the Return chip's KeyText.
const RETURN = "⏎" as KeyText;

/** One change: a kind mark, a name, a short state phrase and its single action (U504). */
const ChangeRow = (props: { id: string; mark: () => RailNode["status"] | null; name: string; phrase: string; action: string; label: string; disabled?: boolean; failure?: string | null; run: () => void }) => (
  <li class="change-row" data-change={props.id}>
    <span class="change-mark"><Show when={props.mark()}>{status => <KindGlyph kind={status().kind} />}</Show></span>
    <span class="change-name">{props.name}</span>
    <span class="change-phrase">{props.failure ?? props.phrase}</span>
    <button type="button" data-button="quiet" class="change-action" aria-label={props.label} aria-disabled={props.disabled} onClick={() => { if (!props.disabled) props.run(); }}>
      {props.action}<KeyChip keys={RETURN} />
    </button>
  </li>
);

/**
 * U504: what waits on the user, then what finished since the last visit, then Ask parts not yet resolved.
 * A visit starts once its reads are in and the list is rendered; the lower boundary stays fixed while it is visible.
 */
export const ChangeList = (props: { ready: boolean; keys: KeyScope; onOpened: () => void }) => {
  const connected = useConnectedProject();
  const { rail, visits, asks } = connected;
  const [lower, setLower] = createSignal<{ seq: number; at: number | null } | null>(null);
  const [retainFailure, setRetainFailure] = createSignal<string | null>(null);

  const retain = () => void visits.retain({ seq: visits.head(), at: Date.now() }).then(setRetainFailure);

  createEffect(() => {
    if (!props.ready) return;

    if (lower() === null) {
      const previous = visits.previous();

      setLower({ seq: previous?.seq ?? visits.head(), at: previous?.at ?? null });
    }

    // Live Events advance what the next visit starts from; this visit's rows stay.
    visits.head();
    queueMicrotask(retain);
  });

  const pinned = createMemo(() => attentionOrder(rail.nodes, rail.dismissed));
  const finished = createMemo(() => lower() === null ? [] : finishedSince(visits.saved(), lower()!.seq));
  const unresolved = createMemo(() => unresolvedParts(asks));
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());

  const fail = (id: string, cause: string | null) => setFailures(all => {
    const next = new Map(all);

    if (cause === null) next.delete(id);
    else next.set(id, cause);

    return next;
  });

  const nameOf = (row: Finished) => rail.nodes.find(node => node.id === row.maker)?.name ?? row.published.at(-1)?.maker_name ?? row.maker;

  const openFinished = (row: Finished) => {
    const newest = row.published.at(-1);

    if (!newest) {
      rail.select(row.maker);
      props.onOpened();

      return;
    }

    fail(row.key, null);
    void openDeliverable(connected.app, newest.project, newest.id).then(cause => fail(row.key, cause), error => fail(row.key, error instanceof Error ? error.message : String(error)));
  };

  const quiet = () => props.ready && pinned().length === 0 && finished().length === 0 && unresolved().length === 0;

  const quietLine = () => {
    const at = lower()?.at;

    return at === null || at === undefined ? copy.firstVisit : copy.quietSince(new Date(at).toISOString());
  };

  return <section class="changes" aria-label={copy.overview} aria-busy={!props.ready} onKeyDown={arrows}>
    <ul class="change-list" aria-live="polite">
      <For each={pinned()}>{node => <ChangeRow id={`${node.id}:${node.attempt}:${node.status_revision}`} mark={() => node.status} name={node.name} phrase={node.status ? LABELS[node.status.kind] : ""}
        action={copy.open} label={`${copy.open} ${node.name}`} run={() => { rail.select(node.id); props.onOpened(); }} />}</For>
      <For each={finished()}>{row => <ChangeRow id={row.key} mark={() => null} name={nameOf(row)} phrase={row.published.length > 0 ? copy.finishedPublished(row.published.length) : copy.finished}
        failure={failures().get(row.key) ?? null} action={row.published.length > 0 ? copy.openResult : copy.open} label={`${row.published.length > 0 ? copy.openResult : copy.open} ${nameOf(row)}`}
        disabled={row.published.length === 0 && !rail.nodes.some(node => node.id === row.maker)} run={() => openFinished(row)} />}</For>
    </ul>
    <AskRows keys={props.keys} onOpened={props.onOpened} />
    <Show when={quiet()}><p class="overview-quiet" data-last-visit={lower()?.at ?? "first"}>{quietLine()}</p></Show>
    <ReservedLine message={retainFailure() && copy.visitNotSaved(retainFailure()!)}><button type="button" data-button="quiet" onClick={retain}>{copy.retry}</button></ReservedLine>
  </section>;
};
