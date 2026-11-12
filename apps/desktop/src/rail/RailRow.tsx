import { alertLevel } from "./alertLevel";
import { Sortable } from "../ui/sortable";
import { createCopyFeedback } from "../ui/CopyButton";
import { outcomeOf } from "../app/seam";
import { captureFocus, queueFocus } from "../keys/focus";
import { ReservedLine } from "../ink/ReservedLine";
import { openOnRelease } from "../ui/contextMenu";
import * as v from "valibot";
import { useConnectedProject } from "../state/connectedProject";
import "../keys/styles.css";
import { copy } from "./copy";
import { Show, createMemo, onCleanup, type JSX } from "solid-js";
import { IconButton } from "../ui/IconButton";
import { TreeView } from "../ui/TreeView";
import { RowIcons } from "./RowIcons";
import type { RowActions } from "./rows";
import { ownKeys } from "./rows";
import { createCutTitle } from "../ui/cutTitle";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Kind } from "@contracts/Kind";
import { Icon } from "../ink/Icon";
import { mergeProps } from "@zag-js/solid";
import { KindGlyph } from "../ink/KindGlyph";
import { FailureLine, Line as FailureCause } from "../ink/FailureLine";
import { descendantsOf, isMode, isWorkstream } from "./layout";
import { rowKind, rowUnread } from "./rollup";
import { Trunks } from "../ui/TreeView";
import type { NodeRow, RailTopology } from "./layout";
import { PadsControl } from "./pads/AgentPads";
import { draftsOf } from "./persist/storage";

/** What Ark's item and branch control take for the row's own element. */
type RowProps = JSX.HTMLAttributes<HTMLDivElement>;

const NameField = (props: { node: RailNode; onCommit: (name: string) => Promise<void>; onFailure: (message: string) => void; onCancel: (restore?: boolean) => void }) => {
  const connected = useConnectedProject();
  const drafts = draftsOf(connected.drafts);
  const destination = { surface: "rail-name", object: props.node.id, recipient: null };
  const current = () => drafts.records().filter((entry) => entry.destination.surface === destination.surface && entry.destination.object === destination.object).at(-1);

  const value = () => {
    const text = current()?.value.text;

    return v.is(v.string(), text) ? text : props.node.name;
  };

  const edit = (field: HTMLInputElement) => drafts.edit(current()?.destination ?? destination,
    { text: field.value, base: current()?.value.base ?? props.node.name },
    { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" }, "ordinary");

  const conflict = () => current() !== undefined && current()?.status !== "pending" && current()?.value.base !== props.node.name;

  const commit = async (field: HTMLInputElement) => {
    if (conflict()) return;
    const snapshot = current() ?? edit(field);
    const name = value().trim();

    if (name === "") {
      props.onCancel();

      return;
    }

    const submitted = (await drafts.submit(snapshot.revision));

    if (!submitted) return;

    try {
      await props.onCommit(name);
      const latest = current()?.revision === submitted.revision;
      drafts.settle(submitted.revision, "acknowledged");

      if (latest) props.onCancel();
    } catch (error) {
      drafts.settle(submitted.revision, outcomeOf(error));

      if (!(error instanceof Error)) throw error;
      props.onFailure(copy.failed(copy.rename, error.message));
    }
  };

  return <>
    <input spellcheck={false} autocorrect="off" autocapitalize="off"
      type="text"
      class="field-inline"
      aria-label={copy.name}
      aria-invalid={conflict() || current()?.status === "failed" ? true : undefined}
      value={value()}
      ref={(field) => {
        captureFocus(true);
        queueFocus(() => {
        field.focus();
        const selection = current()?.selection;

        if (selection) field.setSelectionRange(selection.start, selection.end, selection.direction);
        else field.select();
      }); }}
      onInput={(event) => edit(event.currentTarget)}
      onSelect={(event) => { if (event.currentTarget.isConnected && current()?.status === "draft") edit(event.currentTarget); }}
      onClick={(event) => event.stopPropagation()}
      on:keydown={(key) => {
        if (key.key === "Enter") { key.preventDefault(); void commit(key.currentTarget); }

        if (key.key === "Escape") { key.preventDefault(); key.stopPropagation(); props.onCancel(); }
      }}
      onBlur={() => props.onCancel(false)}
    />
    <ReservedLine overlay status={conflict() ? copy.railDraftConflict : null} />
  </>;
};


/** The worktree facts a row carries: ahead count, CI, pull request, or that they are unavailable. */
const WorktreeChips = (props: { id: string }) => {
  const connected = useConnectedProject();
  const read = () => connected.worktrees.read(props.id);
  const worktreeFailure = () => read()?.failure;

  const facts = () => {
    const current = read();

    return current?.failure === null ? current.state : null;
  };

  return <span class="worktree-chips row-secondary">
        <Show when={(facts()?.ahead ?? 0) > 0}><span class="worktree-chip" role="img" data-state="ahead" aria-label={copy.worktreeAheadState(facts()!.ahead)}>{copy.worktreeAhead(facts()!.ahead)}</span></Show>
        <Show when={facts()?.ci}>{ci => <span class="worktree-chip" role="img" data-state={ci().state} data-stale={ci().stale} aria-label={copy.worktreeCiText(ci().state, ci().stale, true)}>{copy.worktreeCiGlyph(ci().state)} {copy.ci}<Show when={ci().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={facts()?.pr}>{pr => <span class="worktree-chip" role="img" data-state="pr" data-stale={pr().stale} aria-label={copy.worktreePrState(pr().number, pr().stale)}>{copy.worktreePrText(pr().number, false)}<Show when={pr().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={worktreeFailure()}><span class="worktree-chip" data-state="unavailable" role="img" aria-label={copy.worktreeUnavailable}>{copy.worktreeUnavailableMark}</span></Show>
  </span>;
};

/** The count a row shows for children it hides: those folded under it while a drag holds it (U6550a), else its collapsed Agents. */
const FoldedCount = (props: { folded: boolean; topology: RailTopology; id: string; hidden: number | undefined }) => {
  const lifted = () => props.folded ? descendantsOf(props.topology, props.id).length : 0;

  return <Show when={lifted() || props.hidden}>{lifted()
  ? <span class="hidden-agents" data-state="lifted" role="img" aria-label={copy.liftedChildren(lifted())}>{copy.liftedCount(lifted())}</span>
  : <span class="hidden-agents" data-state="collapsed" role="img" aria-label={copy.hiddenAgents(props.hidden!)}>{props.hidden}</span>}</Show>;
};

export const RailRowView = (props: {
  actions: RowActions; doorAction?: JSX.Element;
  topology: RailTopology; todoCount: number;
  row: NodeRow; rootDivider?: boolean; selected: boolean; multiple: boolean; tabbable: boolean; branch: boolean;
  copyWith?: (feedback: ReturnType<typeof createCopyFeedback>) => () => void;
  editing: boolean; onEditing: (editing: boolean) => void; onToggle: () => void; onOpen: (id?: string) => void;
  onRename: (name: string) => Promise<void>; onFailure: (message: string) => void;
  lifted: boolean; /** U6550a: the drag holds this row and its children are folded under it. */ folded: boolean; sortRef: (element: HTMLElement | undefined) => void;
  handleRef: (element: HTMLButtonElement | undefined) => void;
  draggable: boolean;
  onOpenMenu: (x: number, y: number) => void;
}) => {
  const connected = useConnectedProject();
  const copied = createCopyFeedback();
  const unregisterCopy = props.copyWith?.(copied);
  onCleanup(() => unregisterCopy?.());
  let element: HTMLDivElement | undefined;

  const closeName = (restore = true) => { props.onEditing(false);

 if (restore) queueMicrotask(() => element?.focus()); };

  const workstream = () => isWorkstream(props.row.node);
  const cutName = createCutTitle(() => props.row.node.name);

  const isGroup = () => props.row.node.kind === "group";
  const isContainer = () => workstream() || isGroup();
  // U4547a: a Mode folds the Agents it started, as a Workstream folds its own.
  const folds = () => workstream() || isMode(props.row.node) && props.branch;

  // U3800d: each derived value is a memo, so a move that changes none of them runs nothing below it.
  const kind = createMemo((): Kind | null => rowKind(props.topology, props.row.node, node => connected.rail.dismissed(node), isContainer() && props.row.collapsed !== null));

  /** DCL1, U6249d: the first Agent, the row's own, or any below it while the row is folded, whose Messages have not reached it, with the Daemon's cause. An open Workstream adds nothing: its child's own row shows the line. */
  const unreachable = () => [props.row.node, ...(isContainer() && props.row.collapsed ? descendantsOf(props.topology, props.row.node.id) : [])].find(node => node.unreachable);

  const statusLabel = () => {
    const status = props.row.node.status;

    return status?.kind === "error" && connected.rail.dismissed(props.row.node) ? copy.dismissedFailure(status.label) : status?.label ?? "";
  };

  const unread = createMemo(() => rowUnread(props.topology, props.row.node, id => connected.unseen.of(id), isContainer() && props.row.collapsed !== null));
  const level = createMemo(() => alertLevel(props.topology, props.row.node));
  const selected = createMemo(() => props.selected);
  const multiple = createMemo(() => props.multiple);
  const tabbable = createMemo(() => props.tabbable);
  const rootDivider = createMemo(() => props.rootDivider ?? false);
  const pending = createMemo(() => connected.rail.pendingOf(props.row.node.id) ? true : undefined);

  const queuedBadge = () => {
    const queued = workstream() ? connected.queue.entryOf(props.row.node.id) : null;

    return queued ? queued.entry.start.kind === "afterTodo" ? copy.afterBadge(queued.entry.start.todo) : copy.queuedBadge(queued.place) : null;
  };

  // U6248c: an exhausted resume shows its cause once, in the line that carries Resume.
  const exhaustedResume = () => props.row.node.resume?.at === null && props.row.node.status?.kind === "error";

  const rowProps = () => ({
    class: "rail-row", classList: { "row-wash": true, "rail-root-divider": rootDivider() }, "data-id": props.row.node.id,
    title: !props.editing ? cutName.title() : undefined,
    "data-selected": selected() ? "true" : undefined,
    "data-multiple": multiple() ? "true" : undefined,
    tabIndex: tabbable() ? 0 : -1,
    "data-mode": isMode(props.row.node) ? "true" : undefined,
    "data-worktree": props.row.node.worktree ? "true" : undefined,
    "data-editing": props.editing, "aria-busy": pending(), "data-kind": kind() ?? undefined, "data-lifted": props.lifted,
    style: { "--tree-depth": props.row.depth, "--indent": `calc(${props.row.depth} * var(--rail-step) + var(--rail-inset))` },
    onDblClick: (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("button, input") || props.lifted) return;
      props.onEditing(true);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget || event.key !== "F2" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      event.preventDefault(); event.stopPropagation(); props.onEditing(true);
    },
    onContextMenu: (press: MouseEvent) => openOnRelease(press, (x, y) => props.onOpenMenu(x, y)),
  });

  const name = () => <Show when={props.editing} fallback={<span id={`rail-name-${props.row.node.id}`} class="name" ref={cutName.ref}>{copied.copied() ? copy.copied : props.row.node.name}</span>}>
    <NameField node={props.row.node} onCommit={props.onRename} onFailure={props.onFailure} onCancel={closeName} />
  </Show>;

  const choose = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.lifted) return;

    if (!(event.target instanceof Element) || event.target.closest("button, input, a, [contenteditable]")) return;
    props.onOpen();
  };

  const row = (mine: (extra: RowProps) => RowProps) => <div {...mergeProps({ onClick: choose }, mine(rowProps()))} ref={el => { element = el; props.sortRef(el); }}>
    <Trunks depth={props.row.depth} trail={props.row.trail} stem={props.row.children} />
    <p class="line">
      <Show when={folds()}><IconButton class="rail-chevron row-control" aria-label={props.row.collapsed ? copy.expand : copy.collapse} aria-expanded={!props.row.collapsed} {...ownKeys} onClick={event => { event.stopPropagation(); props.onToggle(); }}><Icon name={props.row.collapsed ? "right" : "down"} /></IconButton></Show>
      <span class="row-state"><KindGlyph kind={kind() ?? "idle"} /></span>
      {name()}
      <Show when={level() !== "default" && level()}>{level => <span class="alert-level" data-state="alert-level">{level()}</span>}</Show>
      <FoldedCount folded={props.folded} topology={props.topology} id={props.row.node.id} hidden={props.row.collapsed?.agents.length} />
      <Show when={unread()}><span class="unread-dot row-secondary" data-state="" role="img" aria-label={copy.unreadResult} /></Show>
      <Show when={queuedBadge()}>{badge => <span class="light queue-badge row-secondary">{badge()}</span>}</Show>
      <Show when={!workstream() && props.row.node.worktree}><WorktreeChips id={props.row.node.id} /></Show>
      <span class="row-tail">
        <Show when={!isGroup()}><RowIcons actions={props.actions}>{props.doorAction}</RowIcons></Show>
        <Show when={!isContainer()}><span class="row-controls"><span class="row-control-slot"><PadsControl count={props.todoCount} agent={props.row.node.id} /></span></span></Show>
        <Show when={props.draggable}><Sortable.Handle label={copy.moveItem(props.row.node.name)} ref={props.handleRef} /></Show>
        <Show when={isGroup()}><IconButton class="rail-group-chevron" aria-label={props.row.collapsed ? copy.expand : copy.collapse} aria-expanded={!props.row.collapsed} {...ownKeys} onClick={event => { event.stopPropagation(); props.onToggle(); }}><Icon name={props.row.collapsed ? "right" : "down"} /></IconButton></Show>
      </span>
    </p>
    <Show when={workstream() && !connected.rail.launching(props.row.node.id) && props.row.node.waiting}>{count => <ReservedLine class="rail-waiting" status={copy.doorStoppedWaiting(count())} />}</Show>
    <Show when={unreachable()}>{reached => {
      // DCL1a: only the Agent's transcript can be inspected for an unreadable one; every other cause offers another delivery pass.
      const retry = () => reached().unreachable !== "transcript unreadable";
      const label = () => retry() ? copy.retryUnreachable() : copy.openUnreachable();

      const act = async (event: MouseEvent) => {
        event.stopPropagation();

        if (!retry()) return props.onOpen(reached().id);

        const failed = await connected.rail.retryDelivery(reached().id);

        if (failed !== null) props.onFailure(copy.failed(label(), failed));
      };

      return <ReservedLine class="rail-unreachable" status={copy.cantReach(reached().name, reached().unreachable!)}><button type="button" data-button="quiet" aria-label={`${label()} ${reached().name}`} onClick={act}>{label()}</button></ReservedLine>;
    }}</Show>
    <Show when={!workstream() && props.row.node.resume}>{resume => <Show when={resume().at} fallback={
      <Show when={props.row.node.status?.kind === "error"}>
        <ReservedLine class="rail-resume rail-resume-spent" status={props.row.node.status?.label}><button type="button" data-button="quiet" aria-label={copy.resumeAgent(props.row.node.name)} onClick={event => { event.stopPropagation(); void connected.rail.resumeTurn(props.row.node.id).then(failed => { if (failed !== null) props.onFailure(copy.failed(copy.resume, failed)); }); }}>{copy.resume}</button></ReservedLine>
      </Show>}>
      {at => <ReservedLine class="rail-resume" status={copy.resumesAt(props.row.node.status?.label ?? "", at())} />}
    </Show>}</Show>
    <Show when={workstream() && connected.rail.doorFailure(props.row.node.id)}>{cause => <FailureCause label={cause()} class="rail-door-failure" />}</Show>
    <Show when={props.row.node.start_attribution}>{source => <ReservedLine class="rail-attribution" status={copy.startedBy(source().agent_name, source().project_name)} />}</Show>
    <Show when={!workstream() && !exhaustedResume() && !connected.rail.dismissed(props.row.node)}><FailureLine status={props.row.node.status} dismiss={() => connected.rail.dismiss(props.row.node)} recover={{ run: () => props.onOpen(props.row.node.id), label: copy.openTerminal }} /></Show>
  </div>;

  return <>
    <Show when={props.branch} fallback={<TreeView.Item data-id={props.row.node.id} aria-label={[props.row.node.name, ...(isMode(props.row.node) ? [copy.modeWord] : []), ...(!workstream() && props.row.node.status ? [statusLabel()] : [])].join(copy.comma)} asChild={item => row(extra => item(extra))} />}>
      <TreeView.Branch class="rail-root-branch" data-id={props.row.node.id} aria-label={[props.row.node.name, ...(isMode(props.row.node) ? [copy.modeWord] : []), ...(!workstream() && props.row.node.status ? [statusLabel()] : [])].join(copy.comma)}>
        <TreeView.BranchControl asChild={control => row(extra => control(extra))} />
      </TreeView.Branch>
    </Show>
  </>;
};
