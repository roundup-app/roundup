import { captureFocus } from "../keys/focus";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Change } from "@contracts/todo/Change";
import { createTodoHistory } from "./TodoHistory";
import { outcomeOf } from "../app/seam";
import type { Comment } from "@contracts/todo/Comment";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { Icon } from "../ink/Icon";
import { KindGlyph } from "../ink/KindGlyph";
import { Collapsible } from "../ui/Collapsible";
import { useConnectedProject } from "../state/connectedProject";
import { doesClearTodoFailure, failureOf } from "./failureOf";
import { rowButtonOf, triage } from "./triage";

// Rows are keyed by id so fold state, focus and fade survive an arrival.
const byId = { key: "id" };


type Part = { text: string } | { summary: string; details: string };

const isStatus = (part: Part): part is Extract<Part, { summary: string }> => "summary" in part;

const STATUS = "::status ";

/** U3775: an Agent writes `::status <summary>` and indents its detail lines by two spaces; a status line with no details stays plain text. */
const partsOf = (body: string, marked: boolean): Part[] => {
  const parts: Part[] = [];
  const plain: string[] = [];

  const flush = () => { if (plain.length > 0) parts.push({ text: plain.splice(0).join("\n") }); };

  const lines = body.split("\n");

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!;

    if (!marked || !line.startsWith(STATUS)) { plain.push(line); continue; }

    const details: string[] = [];

    while (lines[at + 1]?.startsWith("  ")) details.push(lines[++at]!.slice(2));

    if (details.length === 0) { plain.push(line.slice(STATUS.length)); continue; }

    flush();
    parts.push({ summary: line.slice(STATUS.length), details: details.join("\n") });
  }

  flush();

  return parts;
};

/** The thread, oldest first, with a field to add to it. Opening reads it and marks it read once; a comment that arrives while it is open is read the same way. */
export const TodoComments = (props: { id: number; onSent?: ((focus: ReturnType<typeof captureFocus>) => void) | undefined; saved?: () => number; onSaved?: () => void; onCapture?: (change: Change | undefined) => void }) => {
  const { app, events, rail, drawer, drafts, now } = useConnectedProject();
  // Keyed by id so a refresh keeps each comment's row, fold state and focus (U3776).
  const [thread, setThread] = createStore<Comment[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [sendFailure, setSendFailure] = createSignal<string | null>(null);
  createEffect(on(props.saved ?? (() => 0), () => setSendFailure(null), { defer: true }));
  const records = () => drafts.list().filter(draft => draft.destination.surface === "todos" && draft.destination.object === String(props.id) && draft.destination.recipient === "comment");
  const current = () => records().at(-1);
  const text = () => String(current()?.value.text ?? "");

  const setText = (value: string) => {
    drafts.edit({ surface: "todos", object: String(props.id), recipient: "comment" }, { text: value }, null, "ordinary");
  };

  createEffect(() => onCleanup(drafts.editor({ surface: "todos", object: String(props.id), recipient: "comment" })));
  const [expanded, setExpanded] = createSignal(false);
  const [commentsLoaded, setCommentsLoaded] = createSignal(false);

  type Entry = { key: string; at: number; seq: number; change: Change } | { key: string; at: number; seq: number; comment: Comment };

  let cutoff: Entry | undefined;
  let initialized = false;

  const history = createTodoHistory({ get id() { return props.id; }, saved: props.saved, onCapture: props.onCapture,
    exposed: () => entries().length >= 0 && initialized && (expanded() || history.unreadOpening().every(change => !older().some(entry => "change" in entry && entry.change.seq === change.seq))) });

  const compare = (a: Entry, b: Entry) => a.at - b.at || Number("comment" in a) - Number("comment" in b) || a.seq - b.seq;

  const entries = createMemo<Entry[]>((previous) => {
    const all: Entry[] = [...(history.changes() ?? []).map(change => ({ key: `h${change.seq}`, at: change.changed_at ?? Number.NEGATIVE_INFINITY, seq: change.seq, change })),
      ...thread.map(comment => ({ key: `c${comment.id}`, at: comment.created_at, seq: comment.id, comment }))];

    all.sort(compare);

    if (!initialized && all.length > 0 && (commentsLoaded() || failure() !== null) && (history.changes() !== undefined || history.failed())) {
      // Anchor the oldest exposed entry: recovery may insert entries on either side.
      cutoff = all.length > 20 ? all[all.length - 20] : undefined;
      initialized = true;
    }

    return all.map(entry => previous?.find(prior => prior.key === entry.key) ?? entry);
  });

  const older = createMemo(() => entries().filter(entry => cutoff && compare(entry, cutoff) < 0));
  const recent = createMemo(() => entries().filter(entry => !cutoff || compare(entry, cutoff) >= 0));
  const [sending, setSending] = createSignal(false);
  // U3776: the comments shown once the Drawer has read them; later arrivals are announced once.
  const [announcement, setAnnouncement] = createSignal("");
  let shown: Set<number> | null = null;
  let latest = 0;
  let alive = true;
  let field: HTMLTextAreaElement | undefined;

  // The rendered text, never the `::status` marker or indent; it stays until the next arrival replaces it.
  const spoken = (comment: Comment) => partsOf(comment.body, comment.author.kind === "agent").map((part) => "summary" in part ? `${part.summary}\n${part.details}` : part.text).join("\n");

  // Only the newest fetch may write or mark, so overlapping answers neither reorder the thread nor mark twice.
  const refresh = async () => {
    const mine = ++latest;
    const id = props.id;

    const message = await failureOf(async () => {
      const comments = await app.rpc("todo.comments", { id });

      if (!alive || mine !== latest || id !== props.id) return;
      const arrived = shown === null ? [] : comments.filter((comment) => !shown!.has(comment.id));
      shown = new Set(comments.map((comment) => comment.id));

      if (arrived.length > 0) setAnnouncement(arrived.map((comment) => `${author(comment)}: ${spoken(comment)}`).join("\n"));
      setThread(reconcile(comments, byId));
      setCommentsLoaded(true);

      if (comments.some((comment) => !comment.read)) await app.rpc("todo.markCommentsRead", { id });
    });

    if (alive && mine === latest && id === props.id) setFailure(message);
  };

  createEffect(on(() => props.id, () => { setThread(reconcile([], byId)); setAnnouncement(""); shown = null; setFailure(null); setSendFailure(null); setCommentsLoaded(false); initialized = false; cutoff = undefined; setExpanded(false); void refresh(); }));
  onCleanup(events.subscribe((event) => {
    if (doesClearTodoFailure(event, props.id)) setSendFailure(null);

    if (event.name === "todo.commented" && event.data.id === props.id) void refresh(); }));
  onCleanup(() => { alive = false; latest++; });

  // U3753: `c` on a triage row asks for this Todo's field.
  createEffect(() => {
    if (triage.commentFor() === props.id && field) {
      triage.focusComment(() => field!.focus());
      triage.askComment(null);
    }
  });

  const author = (comment: Comment) => comment.author.kind === "agent" ? rail.nodes.find((node) => node.id === comment.author.id)?.name ?? comment.author.id : copy.me;
  const glyphOf = (comment: Comment) => comment.author.kind === "agent" ? rail.nodes.find((node) => node.id === comment.author.id) : undefined;

  const send = async () => {
    const focus = captureFocus();
    const body = text();

    if (body.trim() === "" || sending()) return;
    const id = props.id;
    const revision = current()?.revision;

    if (!revision) return;
    setSending(true);

    if (!(await drafts.submit(revision))) { setSending(false);

 return; }

    const message = await failureOf(async () => {
      try { await app.rpc("todo.comment", { id, body }); drafts.settle(revision, "acknowledged"); }
      catch (error) { if (!(error instanceof Error)) throw error; drafts.settle(revision, outcomeOf(error)); throw error; }
    });

    setSending(false);

    if (!alive || id !== props.id) return;
    setSendFailure(message);

    // A rejected call keeps the typed text; the thread catches up through `todo.commented`.
    if (message === null) { props.onSaved?.(); await refresh(); props.onSent?.(focus); }
  };

  const renderEntry = (entry: Entry) => "change" in entry ? history.entry(entry.change) : renderComment(entry.comment);

  const renderComment = (comment: Comment) => <div class="todo-comment" data-comment={comment.id}>
      <p class="todo-comment-head"><Show when={glyphOf(comment)} fallback={<Show when={comment.author.kind === "agent"}><span class="todo-comment-glyph-gap" aria-hidden="true" /></Show>}>{(node) => <KindGlyph kind={node().status?.kind ?? "idle"} />}</Show><span class="todo-comment-author">{author(comment)}</span> <time datetime={new Date(comment.created_at).toISOString()}>{copy.commentTime(comment.created_at, now())}</time>
        <Show when={comment.author.kind === "agent"}><button data-button="quiet" class="word" type="button" onClick={() => field?.focus()}>{copy.reply}</button></Show></p>
      <div class="todo-comment-parts"><For each={partsOf(comment.body, comment.author.kind === "agent")}>{(part) => isStatus(part)
        ? <Collapsible.Root class="todo-status" lazyMount unmountOnExit>
          <Collapsible.Trigger data-button="quiet" class="word todo-status-summary">{part.summary}</Collapsible.Trigger>
          <Collapsible.Content class="todo-status-details">{part.details}</Collapsible.Content>
        </Collapsible.Root>
        : <p class="todo-comment-body">{part.text}</p>}</For></div>
    </div>;

  return <section class="todo-comments" aria-label={copy.activity}>
    <div class="todo-activity-head"><h3>{copy.activity}</h3>{history.copy}</div>
    {history.feedback}
    <ReservedLine message={failure()}><button data-button="quiet" class="word" type="button" onMouseDown={event => event.preventDefault()} onClick={() => void refresh()}>{copy.commentRetry}</button><button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => setFailure(null)}>{copy.dismissFailure}</button></ReservedLine>
    <Collapsible.Root lazyMount open={expanded()} onOpenChange={details => setExpanded(details.open)}>
      <Show when={older().length > 0}><Collapsible.Trigger data-button="quiet" class="word todo-older">{copy.olderActivity(older().length)}</Collapsible.Trigger></Show>
      <Collapsible.Content class="todo-activity-entries"><For each={older()}>{renderEntry}</For></Collapsible.Content>
    </Collapsible.Root>
    <div class="todo-activity-entries"><For each={recent()}>{renderEntry}</For></div>
    <ReservedLine class="todo-comments-live" status={announcement()} aria-live="polite" aria-atomic="true" />
    <div class="todo-composer"><span class="todo-composer-actor" aria-hidden="true"><Icon name="circle" /></span><textarea spellcheck={false} autocorrect="off" autocapitalize="off" class="todo-comment-field" rows={2} aria-label={copy.commentField} placeholder={copy.commentPlaceholder} value={text()}
      ref={(element) => { field = element; }}
      onInput={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && triage.on()) { event.preventDefault(); drawer.close("key"); rowButtonOf(props.id)?.focus(); }

        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
      }} /></div>
    <ReservedLine message={sendFailure()}><button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => setSendFailure(null)}>{copy.dismissFailure}</button></ReservedLine>
    <p class="todo-comments-send"><button data-button="quiet" class="word" type="button" aria-disabled={text().trim() === "" || sending() ? true : undefined} onClick={() => void send()}>{copy.comment}</button></p>
  </section>;
};
