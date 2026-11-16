import { eventListener } from "@solid-primitives/event-listener";
import { lazy, createMemo, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import { copy } from "./copy";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { queueFocus } from "../keys/focus";
import { LEADER } from "../keys/chords";
import { activationSource, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { createReply } from "../state/read";
import { createItemFailures } from "../ink/itemFailures";
import { failureOf } from "../app/failureOf";
import { createRowCollection, rowKey } from "../ui/RowCollection";
import { CopyButton } from "../ui/CopyButton";
import { InboxRow } from "./InboxRow";
import type { AgentRow, RowActions } from "./InboxRow";
import { sectionsOf } from "./rows";
import { nameOf, revealTerminal } from "../bubbles/places";
import { statusText } from "../terminal/programStatus";
import "./inbox.styles.css";

const TodoHost = lazy(() => import("../todos/TodoDrawer").then(module => ({ default: module.TodoHost })));

const STALE = new Set(["todo.restored", "todo.commented", "todo.commentsRead", "todo.deleted"]);

/** Read comments before Overview chooses its initial section, including comment-only attention. */
export const createInbox = () => {
  const { app, events, rail } = useConnectedProject();

  const unread = createReply(() => true, () => app.rpc("todo.unread", null));

  // The Inbox shows its Agents until the first answer, and keeps the last rows through a failed read.
  const rows = (): readonly UnreadComment[] => unread.reply() ?? [];
  const failure = () => unread.error()?.message ?? null;
  const loaded = () => unread.reply() !== undefined || unread.error() !== undefined;
  const refresh = unread.refetch;

  onCleanup(events.subscribe(event => { if (STALE.has(event.name)) refresh(); }));

  const groups = createMemo(() => sectionsOf(rail.nodes, rows(), rail.dismissed, rail.terminals()));

  const records = () => groups().flatMap(group => [
    ...group.node ? [{ id: group.node.id + ":" + group.node.attempt + ":" + group.node.status_revision, at: group.node.status?.since ?? 0 }] : [],
    ...group.terminal ? [{ id: `${group.id}:${group.terminal.status?.since}`, at: group.terminal.status?.since ?? 0 }] : [],
    ...group.comments.map(row => ({ id: `c:${row.comment.id}`, at: row.comment.created_at })),
  ]);

  return { loaded, rows, failure, refresh, groups, records };
};

/** U3770: grouped attention in Overview; opening a comment retains the Todo's read action. */
export const Inbox = (props: { state?: ReturnType<typeof createInbox> }) => {
  const { app, drawer, rail, reducedMotion, project } = useConnectedProject();
  const state = untrack(() => props.state) ?? createInbox();
  const { loaded, rows, failure, refresh, groups } = state;
  const [copyFailure, setCopyFailure] = createSignal<string | null>(null);
  const [openKey, setOpenKey] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  // P3557c: a row's failure leaves with its Agent or Terminal.
  const failures = createItemFailures<string>(() => [...rail.nodes.map((node) => `a:${node.id}`), ...rail.terminals().map((terminal) => `a:terminal:${terminal.id}`)]);
  const heads = new Map<string, HTMLElement>();
  let alive = true;
  let live = false;
  let seen = new Set<string>();
  let root: HTMLElement | undefined;
  onSettled(() => { live = true; });
  onCleanup(() => { alive = false; });

  const model = createMemo((): AgentRow[] => {
    const before = seen;
    seen = new Set();

    return groups().flatMap((group): AgentRow[] => {
      const { node, terminal } = group;

      if (terminal) {
        seen.add(group.id);

        return [{ key: `a:${group.id}`, terminal, arrived: live && !reducedMotion() && !before.has(group.id) }];
      }

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
    ...group.terminal ? [{ value: `a:${group.id}`, label: nameOf(group.terminal) }] : [],
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

    return [row.label, agent?.terminal ? statusText(agent.terminal.status!) : agent?.node?.status?.label ?? comment?.comment.body].filter(Boolean).join("\n");
  }).join("\n\n");

  const head = (key: string, element: HTMLElement) => {
    heads.set(key, element);
    content.register(element, key);
  };

  const flag = (key: string, on: boolean) => setBusy((current) => {
    const next = new Set(current);

    if (on) next.add(key);
    else next.delete(key);

    return next;
  });

  const fail = (key: string, message: string | null): void => {
    if (message === null) failures.clear(key);
    else failures.fail(key, message);
  };

  const actions: RowActions = {
    retry: (row) => void (async () => {
      const { node } = row;

      if (!node) return;

      if (busy().has(row.key)) return;

      flag(row.key, true);

      const message = await failureOf(() => app.rpc("agent.resume", { id: node.id }));

      if (!alive) return;

      flag(row.key, false);
      fail(row.key, message);

      if (message !== null) setOpenKey(row.key);
    })(),
    open: (row) => {
      drawer.close();

      if (row.terminal) {
        // The Switcher's way to a Terminal (U529): select its owner, then reveal its bubble.
        revealTerminal(rail, project.path, row.terminal);
      } else rail.select(row.node.id);
    },
    busy: (row) => busy().has(row.key),
    failure: (row) => failures.failure(row.key) ?? null,
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

  const agentRow = (id: string) => <Show when={byKey().get("a:" + id)}>{(row) => {
    const key = untrack(row).key;
    onCleanup(() => heads.delete(key));

    return <InboxRow row={row()} open={openKey() === row().key} toggle={() => toggle(row().key)} actions={actions} selected={content.selection.isSelected(row().key)} head={(element) => head(key, element)} />;
  }}</Show>;

  const commentRow = (row: UnreadComment) => {
    onCleanup(() => heads.delete(`c:${row.comment.id}`));

    return <li class="inbox-item"><button type="button" data-button="quiet" class="inbox-row inbox-comment" data-comment={row.comment.id} data-overview-item={`c:${row.comment.id}`}
      ref={element => head(`c:${row.comment.id}`, element)} data-selected={String(content.selection.isSelected(`c:${row.comment.id}`))}
      onClick={event => drawer.open(() => <TodoHost id={row.todo} />, activationSource(event), { kind: "todo", project: project.path })}>
      <KindGlyph kind="needs-you" /><span class="inbox-row-name">{copy.inboxRow(rail.nameOf(row.comment.author), row.title)}</span>
      <span class="inbox-row-line">{row.comment.body}</span>
    </button></li>;
  };

  const loadFailure = dismissable(failure);

  return <section class="inbox" aria-label={copy.needsYou} ref={[element => { root = element; }, eventListener(["click", content.click, { capture: true }]), eventListener(["keydown", rowKey, { capture: true }])]} tabindex={-1}>
    <Show when={selectedText() !== ""}><div class="inbox-title"><CopyButton app={app} class="word inbox-copy" text={selectedText()} onSuccess={() => setCopyFailure(null)} onFailure={error => setCopyFailure(copy.copyDraftFailure(error.message))}>{copy.copy}</CopyButton></div></Show>
    <ReservedLine overlay message={copyFailure() ?? loadFailure.message()} dismiss={copyFailure() ? () => setCopyFailure(null) : loadFailure.dismiss} recover={!copyFailure() && loadFailure.message() ? { run: () => refresh(), label: copy.inboxRetry } : undefined} />
    <p class="inbox-count" aria-live="polite" aria-atomic="true">{needsCount() > 0 ? copy.needYou(needsCount()) : ""}</p>
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

  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.inbox"], capture: () => ({ available: () => true, invoke: () => { drawer.close(); showView(null); rail.select(null); showView("attention"); queueFocus(() => document.querySelector<HTMLElement>('.made-heading button')?.focus()); } }) }]);

  return null;
};
