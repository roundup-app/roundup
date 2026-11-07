import { createComputed, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createRowCollection, rowKey } from "../ui/RowCollection";
import { copy } from "./copy";
import { openDeliverable } from "./openDeliverable";
import { Icon } from "../ink/Icon";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { createCopyLabels } from "../ui/CopyButton";
import { writeText } from "../app/clipboard";
import { Combobox } from "../ui/Combobox";
import { Tip } from "../ui/Tip";
import { contextMenu, linkEntries, openOnRelease } from "../ui/contextMenu";
import type { Deliverable } from "@contracts/deliverable/Deliverable";
import { shelfScope } from "../shelf/scope";

/** DV5: metadata stays separate from resolution. Never retain a resolved path between opens. */
export const createDeliverables = () => {
  const { unseen } = useConnectedProject();

  const [records, setRecords] = createStore<Deliverable[]>([]);
  // Matching publication ids retain their row and keyboard focus across RPC snapshots.
  createComputed(() => setRecords(reconcile(unseen.publications.records(), { key: "id" })));

  return { ...unseen.publications, records: () => records };
};

export const Deliverables = (props: { state: ReturnType<typeof createDeliverables> }) => {
  const connected = useConnectedProject();
  const scope = shelfScope(connected);
  const [filter, setFilter] = createSignal("");

  const choices = createMemo(() => [
    { value: "", label: copy.overview },
    ...connected.rail.nodes.filter(node => node.kind === "workstream").map(node => ({ value: `home:${node.id}`, label: node.name })),
    ...[...new Map(props.state.records().filter(record => record.maker.kind === "agent").map(record => [record.maker.id, record.maker_name])).entries()].map(([id, label]) => ({ value: `maker:${id}`, label })),
  ]);


  const line = dismissable(() => props.state.failure());

  const records = createMemo(() => props.state.records().filter(record => filter() === "" ? scope.includes(record.home, record.maker)
    : filter() === `home:${record.home}` || record.maker.kind === "agent" && filter() === `maker:${record.maker.id}`));

  const selected = connected.madeSelected;
  const setSelected = connected.selectMade;
  const [pending, setPending] = createSignal<string | null>(null);
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());
  const failure = (id: string): string | null => failures().get(id) ?? null;

  const fail = (id: string, cause: string) => setFailures(all => new Map(all).set(id, cause));
  const clear = (id: string) => setFailures(all => all.has(id) ? new Map([...all].filter(([each]) => each !== id)) : all);
  // P3557c: a failure leaves with its record; it never moves to another.
  createEffect(() => {
    const present = new Set(props.state.records().map(record => record.id));
    setFailures(all => [...all.keys()].every(id => present.has(id)) ? all : new Map([...all].filter(([id]) => present.has(id))));
  });
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const open = async (record: Deliverable) => {
    if (pending() !== null || connected.daemonExit() !== null) return;
    setSelected(record.id);
    setPending(record.id);
    clear(record.id);

    try {
      const cause = await openDeliverable(connected.app, record.project, record.id);

      if (!disposed && cause !== null) fail(record.id, cause);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (!disposed) fail(record.id, error.message);
    } finally {
      if (!disposed) setPending(null);
    }
  };

  const heads = new Map<string, HTMLElement>();

  const content = createRowCollection(() => records().filter(record => {
    const head = heads.get(record.id);

    return head && !head.closest("[hidden], [inert], [disabled], [aria-disabled=true]");
  }).map(record => ({ value: record.id, label: record.title })), {
    onActivate: id => {
      const record = records().find(record => record.id === id);

      if (record) void open(record);
    },
  });

  const copied = createCopyLabels(() => records().map(record => record.id));

  const openMenu = (record: Deliverable, x: number, y: number) => {
    const feedback = copied().get(record.id);
    setSelected(record.id);
    clear(record.id);
    void contextMenu(connected.app, linkEntries(connected.app, { kind: "deliverable", project: record.project, id: record.id },
      connected.rail.nodes, node => connected.rail.exitOf(node) === null, cause => fail(record.id, cause)).map(entry => entry.id !== "copy-link" ? entry : {
        ...entry, label: copy.copy, run: () => feedback?.run(async () => {
          const resolved = await connected.app.rpc("deliverable.resolve", { project: record.project, id: record.id }).catch(error => { throw new Error(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))); });

          if (resolved.kind === "unavailable") throw new Error(copy.deliverableUnavailable[resolved.cause]);

          const url = copy.linkUrl("deliverable", encodeURIComponent(record.id), encodeURIComponent(record.project));
          await writeText(connected.app, `${copy.linkNote(url)}\n${JSON.stringify({ home: home(record), publication: status(record), record }, null, 2)}`).catch(error => { throw new Error(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))); });
        }, () => clear(record.id), error => fail(record.id, error.message)),
      }), x, y);
  };

  let section: HTMLElement | undefined;
  registerKeys({ kind: "region", element: () => section }, [{
    chords: ["ContextMenu", "Shift+F10"],
    when: event => event.target instanceof HTMLElement && event.target.matches(".made-open"),
    run: event => {
      if (event.repeat || !(event.target instanceof HTMLElement)) return;
      const id = event.target.closest<HTMLElement>("[data-deliverable]")?.dataset.deliverable;
      const record = records().find(record => record.id === id);

      if (record) {
        const box = event.target.getBoundingClientRect();
        openMenu(record, box.left, box.bottom);
      }
    },
  }]);

  const home = (record: Deliverable) => record.home === null ? copy.overview
    : connected.rail.nodes.find(node => node.id === record.home)?.name ?? copy.unavailableHome;

  const status = (record: Deliverable) => record.target.kind === "external" ? copy.deliverableCurrent
    : record.target.kind === "pad" ? copy.deliverableRevision() : copy.deliverableRetained;

  return <section ref={section} on:click={{ capture: true, handleEvent: content.click }} on:keydown={{ capture: true, handleEvent: rowKey }} class="made" aria-label={copy.deliverables} aria-busy={pending() !== null || props.state.loading()}>
      <Combobox.Picker label={copy.deliverablesFilter} value={filter()} items={choices()} onSelect={setFilter} />
      <ReservedLine message={line.message()} status={props.state.loading() ? copy.deliverablesLoading : null} dismiss={line.dismiss} recover={{ run: () => props.state.reload() }} />
      <Show when={!props.state.loading() && props.state.failure() === null && records().length === 0}><p class="overview-quiet">{copy.deliverablesEmpty}</p></Show>
      <ul class="made-list"><For each={records()}>{record => <li class="made-row" data-deliverable={record.id} data-overview-item={record.id} data-selected={content.selection.isEmpty() ? selected() === record.id : content.selection.isSelected(record.id)}
        onContextMenu={event => openOnRelease(event, (x, y) => openMenu(record, x, y))}>
        <Tip disabled={failure(record.id) !== null} text={copy.openDeliverable(record.title)}>{trigger => <button {...trigger()} type="button" data-button="quiet" class="made-open" ref={element => {
            heads.set(record.id, element); content.register(element, record.id);
            onCleanup(() => { if (heads.get(record.id) === element) heads.delete(record.id); });
          }} data-row-selected={content.selection.isSelected(record.id)} aria-current={selected() === record.id ? "true" : undefined}
          aria-label={copy.openDeliverable(record.title)} aria-describedby={`made-details-${record.id} made-time-${record.id}`} aria-disabled={pending() !== null}
          onClick={() => { void open(record); }}>
          <span class="made-content">
            <span class="made-title">{copied().get(record.id)?.copied() ? copy.copied : record.title}</span>
            <span class="made-status" data-state={record.target.kind}>{status(record)}</span>
            <span id={`made-details-${record.id}`} class="made-details">{copy.deliverableAttribution(record.maker_name, home(record))}</span>
            <time id={`made-time-${record.id}`} class="made-details" datetime={new Date(record.published_at).toISOString()}>{copy.publishedWhen(new Date(record.published_at).toISOString())}</time>
          </span>
          <Icon name="right" />
        </button>}</Tip>
        <ReservedLine overlay message={failure(record.id)} dismiss={() => clear(record.id)} />
      </li>}</For></ul>
    </section>;
};
