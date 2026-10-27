import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { LEADER } from "../keys/chords";
import { activationSource, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { createRowCollection, rowKey } from "../ui/RowCollection";
import { CopyButton } from "../ui/CopyButton";
import { TodoHost } from "../todos/TodoDrawer";
import { InboxRow } from "./InboxRow";
import type { AgentRow, RowActions } from "./InboxRow";
import { sectionsOf } from "./rows";
import "./inbox.styles.css";

const STALE = new Set(["todo.restored", "todo.commented", "todo.commentsRead", "todo.deleted"]);

const sectionTitle = (title: string, count: () => number, live = false, ref?: (element: HTMLHeadingElement) => void) => <div class="inbox-group-head">
  <h3 ref={ref} tabindex={ref ? -1 : undefined}>{title}</h3>
  <span class="inbox-count" data-state="" aria-live={live ? "polite" : undefined} aria-atomic={live ? "true" : undefined}>{count()}</span>
</div>;

/**
 * The Drawer's grouped list (U3770): Needs you, Running and Done. Agent rows follow `rail.nodes`;
 * one row per unread Agent comment is read from `todo.unread` and the Todo events, never from a Message. Opening a comment's
 * Todo marks it read (the Todo Drawer), and the row leaves.
 */
export const Inbox = () => {
  const { app, events, drawer, rail, reducedMotion } = useConnectedProject();
  const [rows, setRows] = createSignal<readonly UnreadComment[]>([]);
  const [copyFailure, setCopyFailure] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [openKey, setOpenKey] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());
  const heads = new Map<string, HTMLElement>();
  let latest = 0;
  let alive = true;
  let live = false;
  let seen = new Set<string>();
  let root: HTMLElement | undefined;

  const refresh = async () => {
    const mine = ++latest;
    let unread: UnreadComment[] = [];
    const message = await failureOf(async () => { unread = await app.rpc("todo.unread", null); });

    if (!alive || mine !== latest) return;

    if (message === null) setRows(unread);

    setFailure(message);
  };

  void refresh();
  onMount(() => { live = true; });
  onCleanup(events.subscribe((event) => { if (STALE.has(event.name)) void refresh(); }));
  onCleanup(() => { alive = false; latest++; });

  /** U3770a: the sections as the Rail says them now. */
  const model = createMemo(() => {
    const sections = sectionsOf(rail.nodes);
    const before = seen;

    seen = new Set();

    const row = (group: string) => (node: RailNode): AgentRow => {
      seen.add(`${group}:${node.id}`);

      return { key: `a:${node.id}`, node, arrived: live && !reducedMotion() && !before.has(`${group}:${node.id}`) };
    };

    return { needs: sections.needs.map(row("needs")), running: sections.running.map(row("running")), done: sections.done.map(row("done")) };
  });

  const byKey = createMemo(() => new Map([...model().needs, ...model().running, ...model().done].map((each) => [each.key, each])));
  const needsKeys = createMemo(() => model().needs.map((each) => each.key));
  const runningKeys = createMemo(() => model().running.map((each) => each.key));
  const doneKeys = createMemo(() => model().done.map((each) => each.key));
  const needsCount = () => model().needs.length + rows().length;
  const total = () => needsCount() + model().running.length + model().done.length;

  const toggle = (key: string) => setOpenKey((current) => current === key ? null : key);

  // One collection follows the mounted section order; actions and disclosure bodies never join it.
  const content = createRowCollection(() => [
    ...model().needs.map(row => ({ value: row.key, label: row.node.name })),
    ...rows().map(row => ({ value: `c:${row.comment.id}`, label: copy.inboxRow(rail.nameOf(row.comment.author), row.title) })),
    ...model().running.map(row => ({ value: row.key, label: row.node.name })),
    ...model().done.map(row => ({ value: row.key, label: row.node.name })),
  ].filter(row => {
    const head = heads.get(row.value);

    return head && !head.closest("[hidden], [inert], [disabled], [aria-disabled=true]");
  }), {
    onActivate: key => {
      const agent = byKey().get(key);
      const comment = rows().find(row => `c:${row.comment.id}` === key);

      if (agent) toggle(key);
      else if (comment) drawer.open(() => <TodoHost id={comment.todo} />, "key");
    },
  });

  const selectedText = () => content.collection().items.filter(row => content.selection.isSelected(row.value)).map(row => {
    const agent = byKey().get(row.value);
    const comment = rows().find(each => `c:${each.comment.id}` === row.value);

    return [row.label, agent?.node.status?.label ?? comment?.comment.body].filter(Boolean).join("\n");
  }).join("\n\n");

  const head = (key: string, element: HTMLElement) => {
    heads.set(key, element);
    content.register(element, key);
    onCleanup(() => heads.delete(key));
  };

  const flag = (key: string, on: boolean) => setBusy((current) => {
    const next = new Set(current);

    if (on) next.add(key);
    else next.delete(key);

    return next;
  });

  createEffect(() => {
    const keys = new Set(rail.nodes.map((node) => `a:${node.id}`));

    setFailures((current) => [...current.keys()].some((key) => !keys.has(key))
      ? new Map([...current].filter(([key]) => keys.has(key))) : current);
  });

  const fail = (key: string, message: string | null) => setFailures((current) => {
    const next = new Map(current);

    if (message === null) next.delete(key); else next.set(key, message);

    return next;
  });

  const actions: RowActions = {
    retry: (row) => void (async () => {
      if (busy().has(row.key)) return;

      flag(row.key, true);

      const message = await failureOf(() => app.rpc("agent.resume", { id: row.node.id }));

      if (!alive) return;

      flag(row.key, false);
      fail(row.key, message);

      if (message !== null) setOpenKey(row.key);
    })(),
    open: (row) => { rail.select(row.node.id); drawer.close(); },
    busy: (row) => busy().has(row.key),
    failure: (row) => failures().get(row.key) ?? null,
    dismiss: (row) => { fail(row.key, null); heads.get(row.key)?.focus(); },
  };

  // The Drawer must not close while a row still owns selection or disclosure.
  registerKeys({ kind: "layer", element: () => root, active: () => !content.selection.isEmpty() || openKey() !== null, modal: false }, [{
    chords: ["Escape"],
    run: () => {
      if (!content.selection.isEmpty()) { content.selection.clear(); return; }

      const key = openKey();

      setOpenKey(null);

      if (key !== null) heads.get(key)?.focus();
    },
  }]);

  const agentRow = (key: string) => <Show when={byKey().get(key)}>{(row) =>
    <InboxRow row={row()} open={openKey() === key} toggle={() => toggle(key)} actions={actions} selected={content.selection.isSelected(key)} head={(element) => head(key, element)} />}</Show>;

  return <section class="inbox" aria-label={copy.inbox} ref={root} tabindex={-1} on:click={{ capture: true, handleEvent: content.click }} on:keydown={{ capture: true, handleEvent: rowKey }}>
    <div class="inbox-title"><h2>{copy.inbox}</h2>
      <Show when={selectedText() !== ""}><CopyButton app={app} class="word inbox-copy" text={selectedText()} onSuccess={() => setCopyFailure(null)} onFailure={error => setCopyFailure(copy.copyDraftFailure(error.message))}>{copy.copy}</CopyButton></Show>
    </div>
    <ReservedLine message={copyFailure() ?? failure()} status={total() === 0 ? copy.inboxEmpty : null}><Show when={copyFailure()}><button data-button="quiet" class="word" type="button" onClick={() => setCopyFailure(null)}>{copy.inboxDismiss}</button></Show><Show when={!copyFailure() && failure()}><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.inboxRetry}</button></Show></ReservedLine>
    <Show when={needsCount() > 0 || needsKeys().length > 0}>
      <section class="inbox-group" aria-label={copy.needsYou}>
        {sectionTitle(copy.needsYou, needsCount, true)}
        <ul class="inbox-list">
          <For each={needsKeys()}>{agentRow}</For>
          <For each={rows()}>{(row) => <li class="inbox-item"><button type="button" data-button="quiet" class="inbox-row inbox-comment" data-comment={row.comment.id}
            ref={element => head(`c:${row.comment.id}`, element)} data-selected={content.selection.isSelected(`c:${row.comment.id}`)}
            onClick={(event) => drawer.open(() => <TodoHost id={row.todo} />, activationSource(event))}>
            <KindGlyph kind="needs-you" />
            <span class="inbox-row-name">{copy.inboxRow(rail.nameOf(row.comment.author), row.title)}</span>
            <span class="inbox-row-line">{row.comment.body}</span>
          </button></li>}</For>
        </ul>
      </section>
    </Show>
    <Show when={runningKeys().length > 0}>
      <section class="inbox-group" aria-label={copy.running}>
        {sectionTitle(copy.running, () => runningKeys().length)}
        <ul class="inbox-list"><For each={runningKeys()}>{agentRow}</For></ul>
      </section>
    </Show>
    <Show when={doneKeys().length > 0}>
      <section class="inbox-group" aria-label={copy.done}>
        {sectionTitle(copy.done, () => doneKeys().length)}
        <ul class="inbox-list"><For each={doneKeys()}>{agentRow}</For></ul>
      </section>
    </Show>
  </section>;
};

/** `⌘K I` opens the Inbox as the Drawer. */
export const InboxKey = () => {
  const { drawer, showView } = useConnectedProject();

  registerKeys({ kind: "leader" }, [{ action: LEADER.find(row => row.keys === "I")!, capture: () => ({ available: () => true, invoke: () => { showView(null); drawer.open(() => <Inbox />, "key"); } }) }]);

  return null;
};
