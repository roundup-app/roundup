import { createStore, reconcile } from "solid-js/store";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { MeasurementSummary } from "@contracts/project/MeasurementSummary";
import type { MeasurementCost } from "@contracts/project/MeasurementCost";
import type { MeasurementTime } from "@contracts/project/MeasurementTime";
import type { ConsumedCategory } from "@contracts/project/ConsumedCategory";
import type { WeeklyLimit } from "@contracts/project/WeeklyLimit";
import { RpcError } from "../app/seam";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";
import { Collapsible } from "../ui/Collapsible";
import { Tabs } from "../ui/Tabs";
import { Tip } from "../ui/Tip";
import { clock, duration, exact, listPrice, modelLabel, moneyText, percent, tokenFigure, weekdayTime } from "./measurementFormat";
import "./measurement.styles.css";

const categories: ConsumedCategory[] = ["total", "input", "output", "cache_read", "cache_write"];

const parts = copy.measurementParts;

const retryAfter = 500;

const limitEvery = 60_000;

/** A figure that is only the known part carries a mark that opens its own note. */
const Partial = (props: { note: string }) => <Tip text={props.note}>{(trigger) => <button {...trigger()} data-button="quiet" type="button" class="measurement-mark" aria-label={copy.measurementPartial}>{copy.measurementMark}</button>}</Tip>;

const reported = (cost: MeasurementCost) => cost.reported.map((money) => money.currency === null ? `${money.amount} ?` : moneyText(money.amount, money.currency));

const timeRows = (time: MeasurementTime): [string, string][] => [
  [copy.measurementExecution, time.execution_ns], [copy.measurementTools, time.tools_ns], [copy.measurementHuman, time.human_ns],
  [copy.measurementCoordination, time.coordination_ns], [copy.measurementOther, time.other_ns], [copy.measurementUnmeasured, time.unmeasured_ns],
];

const ratio = (part: string, whole: string) => (BigInt(whole) > 0n ? (Number(BigInt(part)) / Number(BigInt(whole))) * 100 : 0);

/** The current Workstream owns one reader, revision and subscription. Unmount drops late replies. */
export const MeasurementDashboard = (props: { home: string; name: string; back: () => void }) => {
  const connected = useConnectedProject();
  const [data, setData] = createStore<{ snapshot: MeasurementSummary | null }>({ snapshot: null });
  const [category, setCategory] = createSignal<ConsumedCategory>("total");
  const [pending, setPending] = createSignal(false);
  const [failures, setFailures] = createSignal(0);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [removed, setRemoved] = createSignal<string | null>(null);
  const [limit, setLimit] = createSignal<WeeklyLimit | null>(null);
  const [active, setActive] = createSignal<(typeof parts)[number] | null>(null);
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");

  const snapshot = () => data.snapshot;
  // A work-running Workstream follows new measurements; a stopped one shows its last (U3016i).
  const live = () => snapshot()?.time.active === true && connected.daemonExit() === null;
  // One failed read followed by a good one shows nothing (U3016j): only a repeat is a problem.
  const problem = () => (failures() >= 2 ? failure() : snapshot()?.cause ?? null);

  let generation = 0;
  let closed = false;
  let region: HTMLElement | undefined;
  let loadingMore = false;
  let queued = false;
  let retryMore = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const fail = (cause: string) => {
    setFailure(cause);
    setFailures((count) => count + 1);

    if (failures() === 1 && !closed) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void read(retryMore), retryAfter);
    }
  };

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
      clearTimeout(retryTimer);
      setFailures(0);
      setFailure(null);
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

  const readLimit = async () => {
    try {
      const next = await connected.app.rpc("project.weeklyLimit", null);

      if (!closed) setLimit(next);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (!closed) setLimit({ used_percent: null, resets_at: null, reason: error.message });
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
    if (connected.daemonExit() !== null) { ++generation; setFailure(copy.measurementDaemonEnded); setFailures(2); }
  });
  createEffect(() => {
    if (!visible() || !live()) return;
    const timer = setInterval(() => void read(), 1000);
    onCleanup(() => clearInterval(timer));
  });
  createEffect(() => {
    if (!visible() || !live()) return;
    void readLimit();
    const timer = setInterval(() => void readLimit(), limitEvery);
    onCleanup(() => clearInterval(timer));
  });
  onMount(() => region?.focus());
  onCleanup(() => { closed = true; ++generation; clearTimeout(retryTimer); stop(); document.removeEventListener("visibilitychange", changedVisibility); });

  const shares = createMemo(() => {
    const tokens = snapshot()?.tokens;
    const whole = tokens ? parts.reduce((sum, key) => sum + Number(BigInt(tokens[key].known)), 0) : 0;

    return parts.map((key) => ({ key, label: copy.measurementCategory[key], count: tokens?.[key], part: tokens ? Number(BigInt(tokens[key].known)) : 0, whole }));
  });

  const largest = () => shares().reduce((best, share) => (share.part > best.part ? share : best), shares()[0]!);

  const readout = () => {
    const share = shares().find((candidate) => candidate.key === active());

    return share?.count ? `${share.label} ${exact(share.count)} · ${percent(share.part, share.whole)}` : "";
  };

  const price = () => snapshot() ? listPrice(snapshot()!.cost) : null;

  const notes = () => {
    const value = snapshot();
    const limited = limit();
    const reason = limited === null ? (live() ? null : copy.measurementLimitReason) : limited.used_percent === null ? limited.reason : null;

    return [...new Set([...(value?.coverage ?? []), ...(value?.cost.unavailable ?? []), ...(value?.time.coverage ?? []), ...(reason ? [reason] : [])])];
  };

  const most = createMemo(() => Math.max(0, ...(snapshot()?.rows ?? []).map((row) => Number(BigInt(row.tokens[category()].known)))));
  const resets = () => limit()?.resets_at ?? null;
  const used = () => limit()?.used_percent ?? null;

  const moveActive = (step: number) => {
    const index = parts.findIndex((key) => key === active());

    setActive(parts[(index + step + parts.length) % parts.length] ?? null);
  };

  const header = (): JSX.Element => {
    const value = snapshot();

    if (problem()) return <Tip text={copy.measurementProblem(problem()!)}>{(trigger) => <span {...trigger()} class="measurement-state" data-state="stale">{copy.measurementProblem(problem()!)}</span>}</Tip>;

    if (value === null) return <span class="measurement-state">{copy.measurementLoading}</span>;

    return <span class="measurement-state" data-live={live()}>{live() ? copy.measurementLive : copy.measurementStopped(value.last_observed === null ? null : clock(value.last_observed))}</span>;
  };

  const retry = () => <Show when={problem()}><button data-button="quiet" type="button" aria-disabled={pending()} onClick={() => { if (!pending()) void read(retryMore); }}>{copy.retry}</button></Show>;

  return <section class="measurement-dashboard" ref={region} role="region" aria-label={copy.costAndTime} aria-busy={pending()} data-home={props.home} data-revision={snapshot()?.revision} tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); props.back(); } }}>
    <header class="measurement-header"><h2>{props.name}</h2>{header()}<div class="measurement-actions">{retry()}<button data-button="quiet" type="button" onClick={props.back}>{copy.back}</button></div></header>
    <div class="measurement-tiles">
      <div class="measurement-tile" data-tile="time">
        <h3>{copy.measurementTime}</h3>
        <p class="measurement-figure">{copy.measurementElapsed(duration(snapshot()?.time.elapsed_ns ?? null))}<Show when={snapshot() && snapshot()!.time.elapsed_ns === null}><Partial note={copy.measurementPartialTime} /></Show></p>
        <p class="measurement-line">{copy.measurementAgentTime(duration(snapshot()?.time.summed_ns ?? null), (() => { const time = snapshot()?.time;

 return time?.elapsed_ns && BigInt(time.elapsed_ns) > 0n ? `${(Number(BigInt(time.summed_ns)) / Number(BigInt(time.elapsed_ns))).toFixed(1)}×` : null; })())}</p>
      </div>
      <div class="measurement-tile" data-tile="tokens">
        <h3>{copy.measurementTokensTile}</h3>
        <p class="measurement-figure measurement-tokens">{snapshot() ? tokenFigure(snapshot()!.tokens.total) : copy.measurementUnknown}<Show when={snapshot() && snapshot()!.tokens.total.missing > 0}><Partial note={copy.measurementPartialTokens(snapshot()!.tokens.total.missing)} /></Show></p>
        <div class="measurement-stack" role="group" aria-label={copy.measurementShares} tabIndex={0} data-dim={active() !== null} onFocus={() => active() === null && setActive(largest().key)} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); moveActive(1); } else if (event.key === "ArrowLeft") { event.preventDefault(); moveActive(-1); } }}>
          <For each={shares()}>{(share) => <Tip text={share.count ? `${share.label} ${exact(share.count)}` : undefined}>{(trigger) => <span {...trigger({ onPointerEnter: () => setActive(share.key) })} class="measurement-segment" data-category={share.key} data-active={active() === share.key} style={{ width: `${share.whole > 0 ? (share.part / share.whole) * 100 : 0}%` }} />}</Tip>}</For>
        </div>
        <ul class="measurement-legend"><For each={shares()}>{(share) => <li data-category={share.key}><span class="measurement-swatch" />{share.label} {percent(share.part, share.whole)}</li>}</For></ul>
        <p class="measurement-line">{largest().part > 0 ? copy.measurementLargest(largest().label, percent(largest().part, largest().whole)) : copy.measurementUnknown}</p>
        <p class="measurement-line" aria-live="polite">{readout()}</p>
      </div>
      <div class="measurement-tile" data-tile="price">
        <h3>{copy.measurementPrice}</h3>
        <p class="measurement-figure">{price() === null ? copy.measurementUnknown : `≈ ${price()}`}
          <Show when={snapshot()}>{(value) => <Tip class="ink-tip" content={<><For each={value().cost.reference}>{(estimate) => <div>{modelLabel(estimate.rates.model)} {moneyText(estimate.amount, estimate.rates.currency)}</div>}</For><For each={reported(value().cost)}>{(figure) => <div>{copy.measurementPriceReported(figure)}</div>}</For><Show when={value().cost.unavailable.length > 0 || value().cost.reference.some((estimate) => estimate.missing.length > 0)}><div>{copy.measurementPartialPrice}</div></Show></>}>{(trigger) => <button {...trigger()} data-button="quiet" type="button" class="measurement-mark" aria-label={copy.measurementPriceDetail}>{copy.measurementInfo}</button>}</Tip>}</Show>
        </p>
        <p class="measurement-line">{copy.measurementNotYourBill}</p>
      </div>
    </div>
    <div class="measurement-limit" data-near={(used() ?? 0) >= 80}>
      <span class="measurement-label">{copy.measurementLimit}</span>
      <span class="measurement-limit-text">{used() === null ? copy.measurementUnknown : copy.measurementLimitUsed(`${used()}%`, resets() === null ? null : weekdayTime(resets()!), used()! >= 80)}</span>
      <span class="measurement-meter" data-unknown={used() === null} role="meter" aria-label={copy.measurementLimit} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used() ?? undefined}><span style={{ width: `${Math.min(100, used() ?? 0)}%` }} /></span>
    </div>
    <section class="measurement-section" aria-label={copy.measurementTimeSpent}>
      <h3>{copy.measurementTimeSpent} <span class="measurement-note">{copy.measurementTimeSpentNote}</span></h3>
      <dl class="measurement-time"><For each={snapshot() ? timeRows(snapshot()!.time) : []}>{([label, value]) => <div><dt>{label}</dt><dd><span class="measurement-bar"><span style={{ width: `${ratio(value, snapshot()!.time.summed_ns)}%` }} /></span><span class="measurement-duration">{duration(value)}</span></dd></div>}</For></dl>
    </section>
    <section class="measurement-section measurement-agents" aria-label={copy.measurementAgents(snapshot()?.contributors ?? 0)}>
      <h3>{copy.measurementAgents(snapshot()?.contributors ?? 0)}</h3>
      <Tabs.Root value={category()} onValueChange={({ value }) => { const chosen = categories.find((key) => key === value);

        if (chosen) setCategory(chosen); }}>
        <Tabs.List aria-label={copy.measurementRank}><For each={categories}>{(key) => <Tabs.Trigger value={key}>{copy.measurementCategory[key]}</Tabs.Trigger>}</For></Tabs.List>
      </Tabs.Root>
      <Show when={removed()}>{(name) => <p class="measurement-note">{copy.measurementRemoved(name())}</p>}</Show>
      <Show when={snapshot()?.contributors === 0}><p>{copy.measurementEmpty}</p></Show>
      <table><thead><tr><th>{copy.measurementAgent}</th><For each={categories}>{(key) => <th>{copy.measurementCategory[key]}</th>}</For></tr></thead>
        <tbody><For each={snapshot()?.rows ?? []}>{(row) => <tr><th scope="row"><Tip text={row.maker}>{(trigger) => <button {...trigger()} data-button="quiet" type="button" onClick={() => { if (row.removed || !connected.rail.nodes.some((node) => node.id === row.agent)) setRemoved(row.maker); else { connected.rail.select(row.agent); props.back(); } }}>{row.maker}</button>}</Tip>
          <span class="measurement-bar"><span style={{ width: `${most() > 0 ? (Number(BigInt(row.tokens[category()].known)) / most()) * 100 : 0}%` }} /></span>
          <Collapsible.Root><Collapsible.Trigger data-button="quiet" class="word" aria-label={copy.measurementAgentDetail(row.maker)}>{copy.measurementDetail}</Collapsible.Trigger><Collapsible.Content>
            <p class="measurement-note">{copy.measurementJoin(listPrice(row.cost) ?? copy.measurementUnknown, ...reported(row.cost), copy.measurementAgentTime(duration(row.time.summed_ns), null))}</p>
            <For each={[...new Set([...row.coverage, ...row.cost.unavailable, ...row.time.coverage])].filter((cause) => !notes().includes(cause))}>{(cause) => <p class="measurement-note">{cause}</p>}</For>
          </Collapsible.Content></Collapsible.Root>
        </th><For each={categories}>{(key) => <td>{exact(row.tokens[key])}<Show when={row.tokens[key].missing > 0}><Partial note={copy.measurementPartialTokens(row.tokens[key].missing)} /></Show></td>}</For></tr>}</For></tbody>
      </table>
      <Show when={snapshot()?.next_offset != null}><button data-button="quiet" type="button" aria-disabled={pending()} onClick={() => { if (!pending()) void read(true); }}>{copy.measurementLoadMore}</button></Show>
    </section>
    <Collapsible.Root class="measurement-detail measurement-how">
      <Collapsible.Trigger data-button="quiet" class="word">{copy.measurementHow(notes().length)}</Collapsible.Trigger>
      <Collapsible.Content>
        <For each={snapshot()?.cost.reference ?? []}>{(estimate) => <p class="measurement-note">{copy.measurementRates(modelLabel(estimate.rates.model), estimate.rates)}</p>}</For>
        <For each={notes()}>{(note) => <p class="measurement-note">{note}</p>}</For>
        <Show when={snapshot()}>{(value) => <p class="measurement-note">{copy.measurementRevision(value().revision)}</p>}</Show>
      </Collapsible.Content>
    </Collapsible.Root>
  </section>;
};
