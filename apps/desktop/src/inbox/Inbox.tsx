import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { queueFocus } from "../keys/focus";
import { LEADER } from "../keys/chords";
import { activationSource, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { createRowCollection, rowKey } from "../ui/RowCollection";
import { CopyButton } from "../ui/CopyButton";
import { TodoHost } from "../todos/TodoDrawer";
import { InboxRow } from "./InboxRow";
import type { RowActions } from "./InboxRow";
import { sectionsOf } from "./rows";
import "./inbox.styles.css";

const STALE = new Set(["todo.restored", "todo.commented", "todo.commentsRead", "todo.deleted"]);

/** Read comments before Overview chooses its initial section, including comment-only attention. */
export const createInbox = () => {
  const { app, events, rail } = useConnectedProject();

  const [read, { refetch }] = createResource(async (_key, { value }): Promise<{ rows: readonly UnreadComment[]; failure: string | null }> => {
    let rows: readonly UnreadComment[] = value?.rows ?? [];
    const failure = await failureOf(async () => { rows = await app.rpc("todo.unread", null); });

    return { rows, failure };
  });

  const rows = () => read()?.rows ?? [];
  const failure = () => read()?.failure ?? null;
  const loaded = () => read() !== undefined;
  const refresh = () => { void refetch(); };

  onCleanup(events.subscribe(event => { if (STALE.has(event.name)) refresh(); }));

  const groups = createMemo(() => sectionsOf(rail.nodes, rows(), rail.dismissed));

  const records = () => groups().flatMap(group => [
    ...group.node ? [{ id: group.node.id + ":" + group.node.attempt + ":" + group.node.status_revision, at: group.node.status?.since ?? 0 }] : [],
    ...group.comments.map(row => ({ id: `c:${row.comment.id}`, at: row.comment.created_at })),
  ]);

  return { loaded, rows, failure, refresh, groups, records };
};

/** U3770: grouped attention in Overview; opening a comment retains the Todo's read action. */
export const Inbox = (props: { state?: ReturnType<typeof createInbox> }) => {
  const { app, drawer, rail, reducedMotion, project } = useConnectedProject();
  const state = props.state ?? createInbox();
  const { loaded, rows, failure, refresh, groups } = state;
  const [copyFailure, setCopyFailure] = createSignal<string | null>(null);
  const [openKey, setOpenKey] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());
  const heads = new Map<string, HTMLElement>();
  let alive = true;
  let live = false;
  let seen = new Set<string>();
  let root: HTMLElement | undefined;
  onMount(() => { live = true; });
  onCleanup(() => { alive = false; });

  const model = createMemo(() => {
    const before = seen;
    seen = new Set();

    return groups().flatMap(group => {
      const node = group.node;

      if (!node) return [];
      seen.add(node.id);

      return [{ key: `a:${node.id}`, node, arrived: live && !reducedMotion() && !before.has(node.id) }];
    });
  });

  const byKey = createMemo(() => new Map(model().map(each => [each.key, each])));
  const needsCount = () => model().length + rows().length;

  const toggle = (key: string) => setOpenKey((current) => current === key ? null : key);

  // One collection follows the mounted section order; actions and disclosure bodies never join it.
  const content = createRowCollection(() => groups().flatMap(group => [
    ...group.node ? [{ value: `a:${group.node.id}`, label: group.node.name }] : [],
    ...group.comments.map(row => ({ value: `c:${row.comment.id}`, label: copy.inboxRow(rail.nameOf(row.comment.author), row.title) })),
  ]).filter(row => {
    const head = heads.get(row.value);

    return head && !head.closest("[hidden], [inert], [disabled], [aria-disabled=true]");
  }), {
    onActivate: key => {
      const agent = byKey().get(key);
      const comment = rows().find(row => `c:${row.comment.id}` === key);

      if (agent) toggle(key);
      else if (comment) drawer.open(() => <TodoHost id={comment.todo} />, "key", { kind: "todo", project: project.path });
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
    open: (row) => { drawer.close(); rail.select(row.node.id); },
    busy: (row) => busy().has(row.key),
    failure: (row) => failures().get(row.key) ?? null,
    dismiss: (row) => { fail(row.key, null); heads.get(row.key)?.focus(); },
  };

  // The Drawer must not close while a row still owns selection or disclosure.
  registerKeys({ kind: "layer", element: () => root, active: () => !content.selection.isEmpty() || openKey() !== null, modal: false }, [{
    chords: ["Escape"],
    run: () => {
      if (!content.selection.isEmpty()) {
        content.selection.clear();

        return;
      }

      const key = openKey();

      setOpenKey(null);

      if (key !== null) heads.get(key)?.focus();
    },
  }]);

  const agentRow = (id: string) => <Show when={byKey().get("a:" + id)}>{(row) =>
    <InboxRow row={row()} open={openKey() === row().key} toggle={() => toggle(row().key)} actions={actions} selected={content.selection.isSelected(row().key)} head={(element) => head(row().key, element)} />}</Show>;

  const commentRow = (row: UnreadComment) => <li class="inbox-item"><button type="button" data-button="quiet" class="inbox-row inbox-comment" data-comment={row.comment.id} data-overview-item={`c:${row.comment.id}`}
    ref={element => head(`c:${row.comment.id}`, element)} data-selected={content.selection.isSelected(`c:${row.comment.id}`)}
    onClick={event => drawer.open(() => <TodoHost id={row.todo} />, activationSource(event), { kind: "todo", project: project.path })}>
    <KindGlyph kind="needs-you" /><span class="inbox-row-name">{copy.inboxRow(rail.nameOf(row.comment.author), row.title)}</span>
    <span class="inbox-row-line">{row.comment.body}</span>
  </button></li>;

  return <section class="inbox" aria-label={copy.needsYou} ref={root} tabindex={-1} on:click={{ capture: true, handleEvent: content.click }} on:keydown={{ capture: true, handleEvent: rowKey }}>
    <Show when={selectedText() !== ""}><div class="inbox-title"><CopyButton app={app} class="word inbox-copy" text={selectedText()} onSuccess={() => setCopyFailure(null)} onFailure={error => setCopyFailure(copy.copyDraftFailure(error.message))}>{copy.copy}</CopyButton></div></Show>
    <ReservedLine overlay message={copyFailure() ?? failure()}><Show when={copyFailure()}><button data-button="quiet" class="word" type="button" onClick={() => setCopyFailure(null)}>{copy.inboxDismiss}</button></Show><Show when={!copyFailure() && failure()}><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.inboxRetry}</button></Show></ReservedLine>
    <Show when={loaded() && needsCount() === 0 && !failure() && !copyFailure()}><p class="overview-quiet">{copy.inboxEmpty}</p></Show>
    <For each={groups().map(group => group.id)}>{id => <div class="inbox-group" data-agent={id}>
      <ul class="inbox-list">
        {agentRow(id)}
        <For each={groups().find(group => group.id === id)?.comments ?? []}>{commentRow}</For>
      </ul>
    </div>}</For>
  </section>;
};

/** U3770e keeps the existing menu/key command and requests the Overview section. */
export const InboxKey = () => {
  const { drawer, rail, showView } = useConnectedProject();

  registerKeys({ kind: "leader" }, [{ action: LEADER.find(row => row.keys === "I")!, capture: () => ({ available: () => true, invoke: () => { drawer.close(); showView(null); rail.select(null); showView("attention"); queueFocus(() => document.querySelector<HTMLElement>('.overview-section-trigger[aria-expanded="true"]')?.focus()); } }) }]);

  return null;
};
