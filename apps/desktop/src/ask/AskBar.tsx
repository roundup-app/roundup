import { createResource, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { copy } from "../copy";
import { Icon } from "../ink/Icon";
import { ErrorLine } from "../ink/ErrorLine";
import { ASK_CLOSE, CHORDS, chordsFor } from "../keys/chords";
import { registerKeys, type KeyScope } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Mentions } from "../ui/Mentions";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { attentionOrder } from "../rail/attention";
import { descendantsOf, resolvedWorkstream, siblingsOf } from "../rail/layout";
import { Tip } from "../ui/Tip";
import type { Deliverable } from "@contracts/deliverable/Deliverable";
import { IconButton } from "../ui/IconButton";
import { shelfScope } from "../shelf/scope";
import type { RailNode } from "@contracts/agent/RailNode";
import { AskRows } from "./AskRows";
import "./styles.css";

/** The leading `@` and the letters after it, while the user has not yet typed the space that ends the name (U504). */
const mentionOf = (text: string): string | null => /^@(\S*)$/.exec(text)?.[1] ?? null;

/** U504: the Ask bar and its rows. The Project's home screen while the Rail selects no Workstream, and `⌘/` opens it over anything else; Escape closes that and returns focus. */
export const AskBar = () => {
  const connected = useConnectedProject();
  const { asks, rail, daemonExit } = connected;
  const deliverables = createDeliverables();
  const [over, setOver] = createSignal(false);
  const [text, setText] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [dismissed, setDismissed] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let panel: HTMLElement | undefined;
  let field: HTMLTextAreaElement | undefined;
  let returnTo: Element | null = null;

  // With no Workstream at all the Pane's "New Workstream" is the way in, so home leaves it uncovered.
  const shown = () => over() || (rail.selected() === null && (rail.nodes.length > 0 || deliverables.records().length > 0 || deliverables.failure() !== null));

  asks.load();

  const names = createMemo(() => rail.nodes.filter((node) => node.kind === "workstream").map((node) => ({ value: node.name, label: node.name })));

  const matching = createMemo(() => {
    const typed = mentionOf(text());

    return dismissed() || typed === null ? [] : names().filter((item) => item.label.toLowerCase().includes(typed.toLowerCase()));
  });

  createEffect(() => {
    const list = matching();

    if (!list.some((item) => item.value === highlighted())) setHighlighted(list[0]?.value ?? null);
  });

  const close = (restore: boolean): void => {
    setOver(false);

    if (restore && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
  };

  const open = (): void => {
    returnTo = document.activeElement;
    setOver(true);
    queueMicrotask(() => field?.focus());
  };

  registerKeys({ kind: "app" }, [{
    action: CHORDS.find((row) => row.keys === "⌘/")!,
    when: () => daemonExit() === null && !over(),
    capture: () => ({ available: () => daemonExit() === null && !over(),
    invoke: open }),
  }]);
  const scope: KeyScope = { kind: "layer", element: () => panel, active: over, modal: true };

  registerKeys(scope, [
    { chords: chordsFor("⌘/"), run: (press) => { if (!press.repeat) close(true); } },
    { chords: ASK_CLOSE, run: () => { if (matching().length > 0) setDismissed(true); else close(true); } },
  ]);

  const send = (): void => {
    const value = text();

    if (value.trim() === "") return;

    setText("");
    setFailure(null);
    void asks.send(value).then((message) => {
      if (message === null) return;

      setFailure(copy.askNotSent + message);
      setText((now) => (now === "" ? value : now));
    });
  };

  const complete = (name: string): void => {
    setText(`@${name} `);
    field?.focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && matching().length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);

      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();

    const picked = matching().length > 0 ? highlighted() : null;

    if (picked !== null) complete(picked);
    else send();
  };

  return (<>
    <Show when={rail.selected() !== null}><div class="made-context"><Deliverables state={deliverables} /></div></Show>
    <Show when={shown()}>
      <section class="ask-bar" data-mode={over() ? "over" : "home"} aria-label={copy.askBarLabel} ref={(element) => { panel = element; }}>
        <Mentions.Root items={matching()} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onSelect={complete}>
          <Mentions.Field class="ask-input" ref={(element: HTMLTextAreaElement) => { field = element; }}
            rows={1} aria-label={copy.askBarLabel} placeholder={copy.askBarPlaceholder} value={text()} open={matching().length > 0}
            onInput={(event) => { setDismissed(false); setText(event.currentTarget.value); }} onKey={onKey} />
          <Show when={matching().length > 0}><Mentions.List label={copy.askMentions} items={matching()} /></Show>
        </Mentions.Root>
        <Show when={failure() ?? asks.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
        <Show when={!over()}><ProjectOverview /><Deliverables state={deliverables} /></Show>
        <AskRows keys={scope} onOpened={() => close(false)} />
      </section>
    </Show>
  </>);
};

const ProjectOverview = () => {
  const { rail } = useConnectedProject();
  const attention = createMemo(() => attentionOrder(rail.nodes));
  const workstreams = createMemo(() => siblingsOf(rail.nodes, null).flatMap((node) => [node, ...descendantsOf(rail.nodes, node.id)]).filter((node) => node.kind === "workstream"));
  const under = (id: string | null) => attention().filter((node) => resolvedWorkstream(rail.nodes, node.id) === id);

  const entry = (node: RailNode, waiting = false) => <OverviewEntry node={node} waiting={waiting} select={() => rail.select(node.id)} />;

  return <section class="project-overview" aria-label={copy.projectOverview}>
    <Show when={rail.failure()}>{(message) => <ErrorLine message={message()} />}</Show>
    <Show when={attention().length > 0} fallback={<div class="empty-state overview-empty">
      <Icon name="check" />
      <h2 class="overview-heading" data-state="attention">{copy.projectAttention(0)}</h2>
    </div>}>
      <h2 class="overview-heading" data-state="attention">{copy.projectAttention(attention().length)}</h2>
    </Show>
    <ul class="overview-list">
      <For each={workstreams()}>{(node) => <li>
        {entry(node)}
        <Show when={under(node.id).length > 0}><ul class="overview-attention">
          <For each={under(node.id)}>{(agent) => <li>{entry(agent, true)}</li>}</For>
        </ul></Show>
      </li>}</For>
      <For each={under(null)}>{(node) => <li>{entry(node, true)}</li>}</For>
    </ul>
  </section>;
};

const OverviewEntry = (props: { node: RailNode; waiting: boolean; select: () => void }) => {
  const [cut, setCut] = createSignal(false);
  let name: HTMLSpanElement | undefined;
  const measure = () => setCut(!!name && name.scrollWidth > name.clientWidth);

  createEffect(() => {
    if (props.node.name) queueMicrotask(measure);
  });
  onMount(() => {
    if (!name) return;
    const observer = new ResizeObserver(measure);

    observer.observe(name);
    onCleanup(() => observer.disconnect());
  });

  return <Tip text={props.node.name} disabled={!cut()}>{(trigger, focus) => {
    const tip = trigger();

    return <button {...focus} onClick={props.select} type="button" class="overview-entry"
      aria-label={[props.node.name, props.node.status ? LABELS[props.node.status.kind] : ""].filter(Boolean).join(" ")}
      data-feedback="ink" data-button="quiet" onPointerEnter={measure}>
      <Tip text={props.node.status ? LABELS[props.node.status.kind] : ""} disabled={!props.node.status}>{(trigger) =>
        <span {...trigger()} class={props.waiting ? "overview-state ink" : "overview-state"} data-state={props.node.status?.kind} data-tone={props.node.status?.kind === "error" ? "red" : undefined}>
          <Show when={props.node.status}>{(status) => <KindGlyph kind={status().kind} />}</Show>
        </span>
      }</Tip>
      <span {...tip} ref={name} class={props.waiting ? "overview-name ink" : "overview-name"}>{props.node.name}</span>
    </button>;
  }}</Tip>;
};

/** DV5: metadata stays separate from resolution. Never retain a resolved path between opens. */
const createDeliverables = () => {
  const { app, events, daemonExit } = useConnectedProject();

  type Catalogue = { records: Deliverable[]; failure: string | null };

  const [read, { refetch }] = createResource(async (_key, { value }): Promise<Catalogue> => {
    try {
      return { records: await app.rpc("deliverable.list", { home: null, maker: null }), failure: null };
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      return { records: value?.records ?? [], failure: error.message };
    }
  }, { initialValue: { records: [], failure: null } satisfies Catalogue });

  const refresh = () => { if (daemonExit() === null) void refetch(); };

  window.addEventListener("focus", refresh);
  const unsubscribe = events.subscribe(event => { if (event.name === "rail.changed") refresh(); });
  onCleanup(() => { unsubscribe(); window.removeEventListener("focus", refresh); });

  return { records: () => read().records, failure: () => read().failure, loading: () => read.loading, refresh };
};

const Deliverables = (props: { state: ReturnType<typeof createDeliverables> }) => {
  const connected = useConnectedProject();
  const scope = shelfScope(connected);
  const records = createMemo(() => props.state.records().filter(record => scope.includes(record.home, record.maker)));
  const [selected, setSelected] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<{ id: string; cause: string } | null>(null);
  let disposed = false;
  onCleanup(() => { disposed = true; });

  const open = async (record: Deliverable) => {
    if (pending() !== null || connected.daemonExit() !== null) return;
    setSelected(record.id);
    setPending(record.id);
    setFailure(null);

    try {
      const resolved = await connected.app.rpc("deliverable.resolve", { project: record.project, id: record.id });

      if (disposed) return;

      if (resolved.kind === "unavailable") {
        setFailure({ id: record.id, cause: copy.deliverableUnavailable[resolved.cause] });
      } else if (resolved.kind === "external" && !/^https?:\/\//i.test(resolved.url)) {
        setFailure({ id: record.id, cause: copy.deliverableUnsafe });
      } else {
        await connected.app.openTarget(resolved.kind === "external"
          ? { kind: "url", url: resolved.url }
          : { kind: "path", path: resolved.path, line: null });
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      if (!disposed) setFailure({ id: record.id, cause: error.message });
    } finally {
      if (!disposed) setPending(null);
    }
  };

  const home = (record: Deliverable) => record.home === null ? copy.overview
    : connected.rail.nodes.find(node => node.id === record.home)?.name ?? record.home;

  const status = (record: Deliverable) => record.target.kind === "external" ? copy.deliverableCurrent
    : record.target.kind === "pad" ? copy.deliverableRevision(record.target.revision) : copy.deliverableRetained(record.target.sha256.slice(0, 12));

  const target = (record: Deliverable) => record.target.kind === "external" ? record.target.url
    : record.target.kind === "pad" ? record.target.name : record.target.path;

  return <Show when={records().length > 0 || props.state.failure() !== null}>
    <section class="made" aria-label={copy.deliverables} aria-busy={pending() !== null || props.state.loading()}>
      <div class="made-heading"><h2 class="overview-heading">{copy.deliverables}</h2>
        <IconButton aria-label={copy.refresh} onClick={() => { void props.state.refresh(); }}><Icon name="down" /></IconButton>
      </div>
      <Show when={props.state.failure()}>{message => <ErrorLine message={message()} />}</Show>
      <ul class="made-list"><For each={records()}>{record => <li class="made-row" data-deliverable={record.id} data-selected={selected() === record.id}>
        <div class="made-content">
          <div class="made-title">{record.title}<span class="made-status" data-state={record.target.kind}>{status(record)}</span></div>
          <div class="made-details">{copy.deliverableAttribution(record.maker_name, home(record))}</div>
          <div class="made-details">{target(record)}</div>
          <Show when={failure()?.id === record.id}><ErrorLine message={failure()?.cause ?? ""} /></Show>
        </div>
        <IconButton aria-label={copy.openDeliverable(record.title, record.maker_name, home(record), record.id)} aria-disabled={pending() !== null}
          onClick={() => { void open(record); }}><Icon name="right" /></IconButton>
      </li>}</For></ul>
    </section>
  </Show>;
};
