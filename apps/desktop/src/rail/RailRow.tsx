import { alertLevel } from "./alertLevel";
import { Sortable } from "../ui/sortable";
import { createCopyFeedback } from "../ui/CopyButton";
import { outcomeOf } from "../app/seam";
import { captureFocus, queueFocus } from "../keys/focus";
import { DISMISS_ONLY, ReservedLine } from "../ink/ReservedLine";
import { openOnRelease } from "../ui/contextMenu";
import * as v from "valibot";
import { useConnectedProject } from "../state/connectedProject";
import "../keys/styles.css";
import { copy } from "./copy";
import { Show, onCleanup, type JSX } from "solid-js";
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
import { StatusTip } from "../ink/StatusTip";
import { KindGlyph } from "../ink/KindGlyph";
import { FailureLine, Line as FailureCause } from "../ink/FailureLine";
import { descendantsOf, isWorkstream } from "./layout";
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


export const RailRowView = (props: {
  actions: RowActions; doorAction?: JSX.Element;
  topology: RailTopology; todoCount: number;
  row: NodeRow; rootDivider?: boolean; selected: boolean; multiple: boolean; tabbable: boolean; branch: boolean;
  copyWith?: (feedback: ReturnType<typeof createCopyFeedback>) => () => void;
  editing: boolean; onEditing: (editing: boolean) => void; onToggle: () => void; onOpen: (id?: string) => void;
  onRename: (name: string) => Promise<void>; onFailure: (message: string) => void;
  lifted: boolean; sortRef: (element: HTMLElement | undefined) => void;
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

  const kind = (): Kind | null => rowKind(props.topology, props.row.node, node => connected.rail.dismissed(node), isContainer() && props.row.collapsed !== null);

  /** DCL1: the first Agent, the row's own, its direct child, or any below it while the row is folded, whose Messages have not reached it, with the Daemon's cause. */
  const unreachable = () => [props.row.node, ...(isContainer() ? descendantsOf(props.topology, props.row.node.id).filter(node => props.row.collapsed || node.parent === props.row.node.id) : [])].find(node => node.unreachable);

  const statusLabel = () => {
    const status = props.row.node.status;

    return status?.kind === "error" && connected.rail.dismissed(props.row.node) ? copy.dismissedFailure(status.label) : status?.label ?? "";
  };

  const unread = () => rowUnread(props.topology, props.row.node, id => connected.unseen.of(id), isContainer() && props.row.collapsed !== null);

  const queuedBadge = () => {
    const queued = workstream() ? connected.queue.entryOf(props.row.node.id) : null;

    return queued ? queued.entry.start.kind === "afterTodo" ? copy.afterBadge(queued.entry.start.todo) : copy.queuedBadge(queued.place) : null;
  };

  const worktreeFailure = () => connected.worktrees.read(props.row.node.id)?.failure;

  const facts = () => {
    const read = connected.worktrees.read(props.row.node.id);

    return read?.failure === null ? read.state : null;
  };

  const rowProps = () => ({
    class: "rail-row", classList: { "row-wash": true, "rail-root-divider": props.rootDivider ?? false }, "data-id": props.row.node.id,
    title: !props.editing ? cutName.title() : undefined,
    "data-selected": props.selected ? "true" : undefined,
    "data-multiple": props.multiple ? "true" : undefined,
    tabIndex: props.tabbable ? 0 : -1,
    "data-worktree": props.row.node.worktree ? "true" : undefined,
    "data-editing": props.editing, "aria-busy": connected.rail.pendingOf(props.row.node.id) ? true : undefined, "data-kind": kind() ?? undefined, "data-lifted": props.lifted,
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

  const row = (mine: (extra: RowProps) => RowProps) => <StatusTip status={props.row.node.status} dismissed={connected.rail.dismissed(props.row.node)}>{reveal => <div {...mergeProps({ onClick: choose }, mine(mergeProps(rowProps(), reveal())))} ref={el => { element = el; props.sortRef(el); }}>
    <Trunks depth={props.row.depth} trail={props.row.trail} stem={props.row.children} />
    <p class="line">
      <Show when={workstream()}><IconButton class="rail-chevron row-control" aria-label={props.row.collapsed ? copy.expand : copy.collapse} aria-expanded={!props.row.collapsed} {...ownKeys} onClick={event => { event.stopPropagation(); props.onToggle(); }}><Icon name={props.row.collapsed ? "right" : "down"} /></IconButton></Show>
      <span class="row-state"><KindGlyph kind={kind() ?? "idle"} /></span>
      {name()}
      <Show when={alertLevel(props.topology, props.row.node) !== "default" && alertLevel(props.topology, props.row.node)}>{level => <span class="alert-level" data-state="alert-level">{level()}</span>}</Show>
      <Show when={props.row.collapsed?.agents.length}>{hidden => <span class="hidden-agents" data-state="collapsed" role="img" aria-label={copy.hiddenAgents(hidden())}>{hidden()}</span>}</Show>
      <Show when={unread()}><span class="unread-dot row-secondary" data-state="" role="img" aria-label={copy.unreadResult} /></Show>
      <Show when={queuedBadge()}>{badge => <span class="light queue-badge row-secondary">{badge()}</span>}</Show>
      <Show when={!workstream() && props.row.node.worktree}><span class="worktree-chips row-secondary">
        <Show when={(facts()?.ahead ?? 0) > 0}><span class="worktree-chip" role="img" data-state="ahead" aria-label={copy.worktreeAheadState(facts()!.ahead)}>{copy.worktreeAhead(facts()!.ahead)}</span></Show>
        <Show when={facts()?.ci}>{ci => <span class="worktree-chip" role="img" data-state={ci().state} data-stale={ci().stale} aria-label={copy.worktreeCiText(ci().state, ci().stale, true)}>{copy.worktreeCiGlyph(ci().state)} {copy.ci}<Show when={ci().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={facts()?.pr}>{pr => <span class="worktree-chip" role="img" data-state="pr" data-stale={pr().stale} aria-label={copy.worktreePrState(pr().number, pr().stale)}>{copy.worktreePrText(pr().number, false)}<Show when={pr().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={worktreeFailure()}><span class="worktree-chip" data-state="unavailable" role="img" aria-label={copy.worktreeUnavailable}>{copy.worktreeUnavailableMark}</span></Show>
      </span></Show>
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
    <Show when={workstream() && connected.rail.doorFailure(props.row.node.id)}>{cause => <FailureCause label={cause()} class="rail-door-failure" />}</Show>
    <Show when={props.row.node.start_attribution}>{source => <ReservedLine class="rail-attribution" status={copy.startedBy(source().agent_name, source().project_name)} />}</Show>
    <Show when={!workstream() && (props.selected || !connected.rail.dismissed(props.row.node))}><FailureLine status={props.row.node.status} dismissed={connected.rail.dismissed(props.row.node)} action={DISMISS_ONLY} onDismiss={() => connected.rail.dismiss(props.row.node)} /></Show>
  </div>}</StatusTip>;

  return <>
    <Show when={props.branch} fallback={<TreeView.Item data-id={props.row.node.id} aria-label={[props.row.node.name, ...(workstream() && props.row.node.opening_prompt?.trim() ? [copy.modeWord] : []), ...(!workstream() && props.row.node.status ? [statusLabel()] : [])].join(copy.comma)} asChild={item => row(extra => item(extra))} />}>
      <TreeView.Branch class="rail-root-branch" data-id={props.row.node.id} aria-label={[props.row.node.name, ...(workstream() && props.row.node.opening_prompt?.trim() ? [copy.modeWord] : []), ...(!workstream() && props.row.node.status ? [statusLabel()] : [])].join(copy.comma)}>
        <TreeView.BranchControl asChild={control => row(extra => control(extra))} />
      </TreeView.Branch>
    </Show>
  </>;
};
