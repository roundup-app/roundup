import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { leaderChord } from "../keys/chords";
import { activationSource, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { TodoDrawer } from "../todos/TodoDrawer";
import { useTodoList } from "../todos/todoList";
import { InboxRow } from "./InboxRow";
import type { AgentRow, RowActions } from "./InboxRow";
import { sectionsOf } from "./rows";
import "./inbox.styles.css";

/** The Todo's Drawer, with the shared list the Shelf reads (U15); it lives while the Drawer does. */
const TodoHost = (props: { id: number }) => <TodoDrawer id={props.id} todos={useTodoList()} />;

const STALE = new Set(["todo.commented", "todo.commentsRead", "todo.deleted"]);

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

  // Escape collapses the open row and returns focus to it before the Drawer's own Escape sees the press.
  registerKeys({ kind: "layer", element: () => root, active: () => openKey() !== null, modal: false }, [{
    chords: ["Escape"],
    run: () => {
      const key = openKey();

      setOpenKey(null);

      if (key !== null) heads.get(key)?.focus();
    },
  }]);

  const agentRow = (key: string) => <Show when={byKey().get(key)}>{(row) =>
    <InboxRow row={row()} open={openKey() === key} toggle={() => toggle(key)} actions={actions} head={(element) => { heads.set(key, element); onCleanup(() => heads.delete(key)); }} />}</Show>;

  return <section class="inbox" aria-label={copy.inbox} ref={root} tabindex={-1}>
    <h2>{copy.inbox}</h2>
    <ReservedLine message={failure()} status={total() === 0 ? copy.inboxEmpty : null}><Show when={failure()}><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.inboxRetry}</button></Show></ReservedLine>
    <Show when={needsCount() > 0 || needsKeys().length > 0}>
      <section class="inbox-group" aria-label={copy.needsYou}>
        {sectionTitle(copy.needsYou, needsCount, true)}
        <ul class="inbox-list">
          <For each={needsKeys()}>{agentRow}</For>
          <For each={rows()}>{(row) => <li class="inbox-item"><button type="button" data-button="quiet" class="inbox-row inbox-comment" data-comment={row.comment.id}
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
  const { drawer } = useConnectedProject();

  registerKeys({ kind: "leader" }, [{ chords: leaderChord("I"), run: () => drawer.open(() => <Inbox />, "key") }]);

  return null;
};
