import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { UnreadComment } from "@contracts/todo/UnreadComment";
import { copy } from "../copy";
import { plainRefusal } from "../decisions/decisions";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { leaderChord } from "../keys/chords";
import { activationSource, registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "../todos/failureOf";
import { TodoDrawer } from "../todos/TodoDrawer";
import { useTodoList } from "../todos/todoList";
import { InboxRow } from "./InboxRow";
import type { AgentRow, RowActions, Settled } from "./InboxRow";
import { sectionsOf } from "./rows";
import "./inbox.styles.css";

/** The Todo's Drawer, with the shared list the Shelf reads (U15); it lives while the Drawer does. */
const TodoHost = (props: { id: number }) => <TodoDrawer id={props.id} todos={useTodoList()} />;

const STALE = new Set(["todo.commented", "todo.commentsRead", "todo.deleted"]);

const CONFIRM_MS = 900;

/** A safety net for the fold's `transitionend`, which never comes when nothing is painted. */
const FOLD_MS = 400;

const sectionTitle = (title: string, count: () => number, live = false, ref?: (element: HTMLHeadingElement) => void) => <div class="inbox-group-head">
  <h3 ref={ref} tabindex={ref ? -1 : undefined}>{title}</h3>
  <span class="inbox-count" data-state="" aria-live={live ? "polite" : undefined} aria-atomic={live ? "true" : undefined}>{count()}</span>
</div>;

/**
 * The Drawer's grouped list (U3770): Needs you, Running and Done. Agent rows follow `rail.nodes` and the open Decisions;
 * one row per unread Agent comment is read from `todo.unread` and the Todo events, never from a Message. Opening a comment's
 * Todo marks it read (the Todo Drawer), and the row leaves.
 */
export const Inbox = () => {
  const { app, events, drawer, rail, decisions, reducedMotion } = useConnectedProject();
  const [rows, setRows] = createSignal<readonly UnreadComment[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [openKey, setOpenKey] = createSignal<string | null>(null);
  const [settled, setSettled] = createSignal<ReadonlyMap<string, Settled>>(new Map());
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());
  const heads = new Map<string, HTMLElement>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let latest = 0;
  let alive = true;
  let live = false;
  let seen = new Set<string>();
  let root: HTMLElement | undefined;
  let needsHeading: HTMLElement | undefined;

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
  onCleanup(() => { alive = false; latest++; timers.forEach(clearTimeout); });

  /** U3770a/d: the sections as the Rail and the Decisions say them now; an answered row stays in Needs you until it folds. */
  const model = createMemo(() => {
    const lent = settled();
    const sections = sectionsOf(rail.nodes);
    const before = seen;

    seen = new Set();

    const row = (group: string) => (node: RailNode): AgentRow => {
      seen.add(`${group}:${node.id}`);

      const decision = decisions.of(node.id);
      const entry = lent.get(node.id);
      const own = entry && (entry.phase === "gone" ? decision?.id === entry.decision : !decision || decision.id === entry.decision) ? entry : undefined;

      return { key: `a:${node.id}`, node, decision, settled: own, arrived: live && !reducedMotion() && !before.has(`${group}:${node.id}`) };
    };

    const needs = sections.needs.map(row("needs")).filter((each) => each.settled?.phase !== "gone");

    for (const [id, entry] of lent) {
      const node = rail.nodes.find((each) => each.id === id);

      if (entry.phase === "gone" || !node || needs.some((each) => each.node.id === id)) continue;

      needs.splice(Math.min(entry.index, needs.length), 0, { key: `a:${id}`, node, decision: undefined, settled: entry, arrived: false });
    }

    const kept = new Set(needs.filter((each) => each.settled).map((each) => each.node.id));

    return {
      needs,
      running: sections.running.filter((node) => !kept.has(node.id)).map(row("running")),
      done: sections.done.filter((node) => !kept.has(node.id)).map(row("done")),
    };
  });

  const byKey = createMemo(() => new Map([...model().needs, ...model().running, ...model().done].map((each) => [each.key, each])));
  const needsKeys = createMemo(() => model().needs.map((each) => each.key));
  const runningKeys = createMemo(() => model().running.map((each) => each.key));
  const doneKeys = createMemo(() => model().done.map((each) => each.key));
  const needsCount = () => model().needs.filter((each) => !each.settled).length + rows().length;
  const total = () => needsCount() + model().running.length + model().done.length;

  // A folded row stays hidden only while its answered Decision is still open; then the Agent's row shows for its current Kind.
  createEffect(() => {
    const stale = [...settled()].filter(([id, entry]) => entry.phase === "gone" && decisions.of(id)?.id !== entry.decision);

    if (stale.length > 0) setSettled((current) => new Map([...current].filter(([id]) => !stale.some(([gone]) => gone === id))));
  });

  const toggle = (key: string) => setOpenKey((current) => current === key ? null : key);

  const flag = (key: string, on: boolean) => setBusy((current) => {
    const next = new Set(current);

    if (on) next.add(key);
    else next.delete(key);

    return next;
  });

  const fail = (key: string, message: string | null) => setFailures((current) => {
    const next = new Map(current);

    if (message === null) next.delete(key); else next.set(key, message);

    return next;
  });

  const phaseOf = (row: AgentRow, phase: Settled["phase"]) => setSettled((current) => {
    const entry = current.get(row.node.id);

    return entry && entry.phase !== phase ? new Map(current).set(row.node.id, { ...entry, phase }) : current;
  });

  /** The next open Decision's row opens once the answered row folds; the move is the user's own act, so rows below may shift. */
  const openNext = (after: string) => {
    const keys = needsKeys();
    const from = keys.indexOf(after);
    const next = [...keys.slice(from + 1), ...keys.slice(0, Math.max(from, 0))].find((key) => byKey().get(key)?.decision !== undefined && !byKey().get(key)?.settled);

    if (next !== undefined) {
      setOpenKey(next);

      // The answered button left the page with its row; keep a keyboard user on the list.
      queueMicrotask(() => {
        const active = document.activeElement;

        if (!active || active === document.body || active.classList.contains("inbox-confirm")) heads.get(next)?.focus();
      });
    }
    else {
      if (openKey() === after) setOpenKey(null);

      // No Decision is left: the answered row folds inert, so focus goes to the row taking its place, else the one before, else the next section's row or the Drawer.
      const live = (key: string) => !byKey().get(key)?.settled && heads.has(key);
      const rest = [...keys.slice(from + 1).filter(live), ...keys.slice(0, Math.max(from, 0)).reverse().filter(live)];
      const elsewhere = [...runningKeys(), ...doneKeys()].find((key) => heads.has(key));
      // The Needs you section unmounts once nothing is left in it, so its heading is no home; the next section's first row or the Drawer itself is.
      const fallback = rows().length > 0 ? needsHeading : elsewhere === undefined ? root : heads.get(elsewhere);
      const target = rest[0] === undefined ? fallback : heads.get(rest[0]);

      queueMicrotask(() => {
        const active = document.activeElement;

        if (!active || active === document.body || active.classList.contains("inbox-confirm")) target?.focus();
      });
    }
  };

  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.delete(timer); run(); }, ms);

    timers.add(timer);
  };

  const fold = (row: AgentRow) => {
    phaseOf(row, "fold");
    openNext(row.key);
    later(() => phaseOf(row, "gone"), FOLD_MS);
  };

  const settle = (row: AgentRow, text: string) => {
    const entry: Settled = { decision: row.decision!.id, text, phase: "confirm", index: Math.max(needsKeys().indexOf(row.key), 0) };

    if (reducedMotion()) {
      setSettled((current) => new Map(current).set(row.node.id, { ...entry, phase: "gone" }));
      openNext(row.key);

      return;
    }

    setSettled((current) => new Map(current).set(row.node.id, entry));
    later(() => fold(row), CONFIRM_MS);
  };

  const actions: RowActions = {
    answer: (row, quick) => void (async () => {
      const decision = row.decision;

      if (!decision || busy().has(row.key) || decisions.answering(decision.id)) return;

      flag(row.key, true);
      fail(row.key, null);

      let outcome: "acknowledged" | "failed" | "unknown" = "failed";

      try {
        // The answer names the Prompt it meant (B6); a refusal for a lost identity reads plainly (U3750).
        const identity = await app.rpc("decision.capture", { id: decision.id });

        outcome = await decisions.answer(decision.id, quick.word, undefined, identity);
      } catch (thrown) {
        if (!(thrown instanceof Error)) throw thrown;

        fail(row.key, plainRefusal(thrown.message));
      }

      if (!alive) return;

      flag(row.key, false);

      if (outcome === "acknowledged") settle(row, quick.confirmation);
      else setOpenKey(row.key);
    })(),
    retry: (row) => void (async () => {
      if (busy().has(row.key)) return;

      flag(row.key, true);
      fail(row.key, null);

      const message = await failureOf(() => app.rpc("agent.resume", { id: row.node.id }));

      if (!alive) return;

      flag(row.key, false);
      fail(row.key, message);

      if (message !== null) setOpenKey(row.key);
    })(),
    open: (row) => { rail.select(row.node.id); drawer.close(); },
    busy: (row) => busy().has(row.key) || (row.decision !== undefined && decisions.answering(row.decision.id)),
    failure: (row) => failures().get(row.key) ?? (row.decision ? decisions.answerFailure(row.decision.id) : null),
    folded: (row) => phaseOf(row, "gone"),
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
        {sectionTitle(copy.needsYou, needsCount, true, (element) => { needsHeading = element; })}
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
