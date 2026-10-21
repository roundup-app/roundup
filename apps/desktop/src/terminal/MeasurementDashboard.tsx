import { createStore, reconcile } from "solid-js/store";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { MeasurementSummary } from "@contracts/project/MeasurementSummary";
import type { MeasurementCost } from "@contracts/project/MeasurementCost";
import type { MeasurementTime } from "@contracts/project/MeasurementTime";
import type { ConsumedSubtotal } from "@contracts/project/ConsumedSubtotal";
import type { ConsumedCategory } from "@contracts/project/ConsumedCategory";
import { RpcError } from "../app/seam";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";
import { Collapsible } from "../ui/Collapsible";
import { Tabs } from "../ui/Tabs";
import "./measurement.styles.css";

type Reading = { kind: "loading" } | { kind: "failed"; cause: string } | { kind: "ready"; snapshot: MeasurementSummary; failure: string | null };

const categories: ConsumedCategory[] = ["total", "input", "output", "cache_read", "cache_write"];

const tokens = (value: ConsumedSubtotal) => copy.measurementTokens(BigInt(value.known).toLocaleString(), value.missing);

const duration = (ns: string | null) => {
  if (ns === null) return copy.measurementUnknown;
  const value = BigInt(ns);

  if (value > 0n && value < 1_000_000n) return copy.measurementSubMillisecond;

  if (value > 0n && value < 1_000_000_000n) return copy.measurementMilliseconds((value / 1_000_000n).toLocaleString());

  return copy.measurementSeconds((value / 1_000_000_000n).toLocaleString());
};

const Cost = (props: { value: MeasurementCost }) => <div class="measurement-cost">
  <For each={props.value.reference}>{(estimate) => <p>
    <strong>{estimate.rates.currency} {estimate.amount}</strong> {copy.measurementReference}
    <Show when={estimate.missing.length > 0}><span class="measurement-note">{copy.measurementCostMissing(estimate.missing)}</span></Show>
    <span class="measurement-note">{estimate.rates.version} · {estimate.rates.date} · {estimate.rates.basis}</span>
    <span class="measurement-note">{copy.measurementRateBasis(estimate.rates)}</span>
    <span class="measurement-note">{estimate.rates.source}</span>
  </p>}</For>
  <For each={props.value.reported}>{(reported) => <p>
    <strong>{reported.currency ?? copy.measurementUnknownCurrency} {reported.amount}</strong> {copy.measurementReported(reported.scope)}
    <span class="measurement-note">{reported.source} · {reported.basis}</span>
  </p>}</For>
  <Show when={props.value.reference.length === 0 && props.value.reported.length === 0}><p>{copy.measurementUnknown}</p></Show>
  <Show when={props.value.unavailable.length > 0}><p class="measurement-note">{copy.measurementCostPartial}</p></Show>
</div>;

const Time = (props: { value: MeasurementTime }) => <>
  <dl class="measurement-time">
    <For each={[
      [copy.measurementExecution, props.value.execution_ns], [copy.measurementTools, props.value.tools_ns],
      [copy.measurementHuman, props.value.human_ns], [copy.measurementCoordination, props.value.coordination_ns],
      [copy.measurementOther, props.value.other_ns], [copy.measurementUnmeasured, props.value.unmeasured_ns],
    ]}>{([label, value]) => <div><dt>{label}</dt><dd>{duration(value ?? null)}</dd></div>}</For>
  </dl>
  <For each={props.value.coverage}>{(cause) => <p class="measurement-note">{cause}</p>}</For>
</>;

/** The current Workstream owns one reader, revision and subscription. Unmount drops late replies. */
export const MeasurementDashboard = (props: { home: string; name: string; back: () => void }) => {
  const connected = useConnectedProject();
  const [data, setData] = createStore<{ snapshot: MeasurementSummary | null }>({ snapshot: null });
  const [reading, setReading] = createSignal<Reading>({ kind: "loading" });
  const [category, setCategory] = createSignal<ConsumedCategory>("total");
  const [pending, setPending] = createSignal(false);
  const [removed, setRemoved] = createSignal<string | null>(null);
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");

  const snapshot = () => {
    const state = reading();

    return state.kind === "ready" ? state.snapshot : null;
  };

  const cause = () => {
    const state = reading();

    return state.kind === "failed" ? state.cause : state.kind === "ready" ? state.failure ?? state.snapshot.cause : null;
  };

  let generation = 0;
  let closed = false;
  let region: HTMLElement | undefined;
  let loadingMore = false;
  let queued = false;
  let retryMore = false;

  const fail = (cause: string) => setReading((state) => state.kind === "ready" ? { ...state, failure: cause } : { kind: "failed", cause });

  const read = async (more = false) => {
    if (loadingMore) {
      queued = true;

      return;
    }

    const before = snapshot();

    if (more && (before === null || before.next_offset === null)) return;
    const ticket = ++generation;
    const chosen = category();
    const count = before?.rows.length ?? 0;
    loadingMore = true;
    setPending(true);

    try {
      const next = await connected.app.rpc("project.measurementSummary", { home: props.home, category: chosen, offset: more ? before!.next_offset! : 0, revision: more ? before!.revision : null });

      if (closed || ticket !== generation || chosen !== category()) return;
      const current = snapshot();

      if (next.home !== props.home || next.category !== chosen || (current !== null && BigInt(next.revision) < BigInt(current.revision))) return;

      if (more && current?.revision !== next.revision) {
        queued = true;

        return;
      }

      // A revision update invalidates all loaded pages together. Same-revision timer reads
      // preserve those pages and their DOM/focus, rather than replacing them with twenty rows.
      const rows = more ? [...before!.rows, ...next.rows] : current?.revision === next.revision && current.category === next.category && count >= next.rows.length ? current.rows : next.rows;
      setData("snapshot", reconcile({ ...next, rows, next_offset: !more && rows.length > next.rows.length ? current!.next_offset : next.next_offset }, { key: "agent" }));
      retryMore = false;
      setReading({ kind: "ready", snapshot: data.snapshot!, failure: null });
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (!closed && ticket === generation) {
        retryMore = more;

        if (more && error instanceof RpcError && error.code === -32003) {
          retryMore = false;
          queued = true;
        }

        fail(error.message);
      }
    } finally {
      loadingMore = false;

      if (!closed) {
        setPending(false);

        if (queued) { queued = false; void read(); }
      }
    }
  };

  const changedVisibility = () => setVisible(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", changedVisibility);

  const stop = connected.events.subscribe((event) => {
    if (event.name === "project.measurementsChanged") void read();
  });

  createEffect(on(category, () => {
    ++generation;
    void read();
  }));
  createEffect(() => {
    if (connected.daemonExit() !== null) { ++generation; fail(copy.measurementDaemonEnded); }
  });
  createEffect(() => {
    if (!visible() || !snapshot()?.time.active || connected.daemonExit() !== null) return;
    const timer = setInterval(() => void read(), 1000);
    onCleanup(() => clearInterval(timer));
  });
  onMount(() => region?.focus());
  onCleanup(() => { closed = true; ++generation; stop(); document.removeEventListener("visibilitychange", changedVisibility); });

  return <section class="measurement-dashboard" ref={region} role="region" aria-label={copy.costAndTime} aria-busy={pending()} data-home={props.home} data-revision={snapshot()?.revision} tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); props.back(); } }}>
    <header class="measurement-header"><h2>{props.name}</h2><button data-button="quiet" type="button" onClick={props.back}>{copy.back}</button></header>
    <Show when={reading().kind === "loading"}><p>{copy.measurementLoading}</p></Show>
    <Show when={cause()}>{(cause) => <div class="measurement-stale" data-state="stale"><p>{snapshot() ? copy.measurementStale : copy.measurementFailed} {cause()}</p><button data-button="quiet" type="button" aria-disabled={pending()} onClick={() => { if (!pending()) void read(retryMore); }}>{copy.retry}</button></div>}</Show>
    <Show when={snapshot()}>{(value) => <>
      <p class="measurement-note">{copy.measurementObservation(value().last_observed)} · {copy.measurementRevision(value().revision)}</p>
      <Show when={value().contributors === 0}><p>{copy.measurementEmpty}</p></Show>
      <div class="measurement-overview">
        <div><h3>{copy.measurementCost}</h3><Cost value={value().cost} /></div>
        <div><h3>{copy.measurementConsumption}</h3><dl class="measurement-tokens"><For each={categories}>{(key) => <div><dt>{copy.measurementCategory[key]}</dt><dd>{tokens(value().tokens[key])}</dd></div>}</For></dl></div>
      </div>
      <dl class="measurement-elapsed"><div><dt>{copy.measurementElapsed}</dt><dd>{duration(value().time.elapsed_ns)}</dd></div><div><dt>{copy.measurementSummed}</dt><dd>{duration(value().time.summed_ns)}</dd></div></dl>
      <p class="measurement-note">{copy.measurementParallel}</p>
      <Collapsible.Root class="measurement-detail measurement-time-detail">
        <Collapsible.Trigger data-button="quiet" class="word">{copy.measurementTimeDetail}</Collapsible.Trigger>
        <Collapsible.Content><Time value={value().time} /></Collapsible.Content>
      </Collapsible.Root>
      <Collapsible.Root class="measurement-detail measurement-contributors">
        <Collapsible.Trigger data-button="quiet" class="word">{copy.measurementContributors(value().contributors)}</Collapsible.Trigger>
        <Collapsible.Content>
          <Tabs.Root value={value().category} onValueChange={({ value }) => { const chosen = categories.find((category) => category === value);

 if (chosen) setCategory(chosen); }}>
            <Tabs.List aria-label={copy.measurementRank}><For each={categories}>{(key) => <Tabs.Trigger value={key}>{copy.measurementCategory[key]}</Tabs.Trigger>}</For></Tabs.List>
          </Tabs.Root>
          <Show when={removed()}>{(name) => <p class="measurement-note">{copy.measurementRemoved(name())}</p>}</Show>
          <table><thead><tr><th>{copy.measurementAgent}</th><For each={categories}>{(key) => <th>{copy.measurementCategory[key]}</th>}</For></tr></thead>
            <tbody><For each={value().rows}>{(row) => <tr><th scope="row"><button data-button="quiet" type="button" onClick={() => { if (row.removed || !connected.rail.nodes.some((node) => node.id === row.agent)) setRemoved(row.maker); else { connected.rail.select(row.agent); props.back(); } }}>{row.maker}</button>
              <Collapsible.Root><Collapsible.Trigger data-button="quiet" class="word" aria-label={copy.measurementContributorDetail(row.maker)}>{copy.measurementDetail}</Collapsible.Trigger><Collapsible.Content><Cost value={row.cost} /><Time value={row.time} /><For each={row.coverage}>{(cause) => <p class="measurement-note">{cause}</p>}</For></Collapsible.Content></Collapsible.Root>
            </th><For each={categories}>{(key) => <td>{tokens(row.tokens[key])}</td>}</For></tr>}</For></tbody>
          </table>
          <Show when={value().next_offset !== null}><button data-button="quiet" type="button" aria-disabled={pending()} onClick={() => { if (!pending()) void read(true); }}>{copy.measurementLoadMore}</button></Show>
        </Collapsible.Content>
      </Collapsible.Root>
      <Collapsible.Root class="measurement-detail"><Collapsible.Trigger data-button="quiet" class="word">{copy.measurementCoverage}</Collapsible.Trigger><Collapsible.Content>
        <For each={[...value().coverage, ...value().cost.unavailable]}>{(cause) => <p class="measurement-note">{cause}</p>}</For>
      </Collapsible.Content></Collapsible.Root>
    </>}</Show>
  </section>;
};
