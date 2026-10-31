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
import { KindGlyph } from "../ink/KindGlyph";
import { FailureLine } from "../ink/FailureLine";
import { agentKindsBelow, isWorkstream } from "./layout";
import { Trunks } from "../ui/TreeView";
import type { NodeRow } from "./layout";
import { createAgentPads, PadsControl } from "./pads/AgentPads";
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
    <ReservedLine overlay message={conflict() ? copy.railDraftConflict : null} />
  </>;
};


export const RailRowView = (props: {
  actions: RowActions; doorAction?: JSX.Element;
  row: NodeRow; rootDivider?: boolean; selected: boolean; multiple: boolean; tabbable: boolean; branch: boolean;
  copyWith?: (feedback: ReturnType<typeof createCopyFeedback>) => () => void;
  editing: boolean; onEditing: (editing: boolean) => void; onToggle: () => void;
  onRename: (name: string) => Promise<void>; onFailure: (message: string) => void;
  lifted: boolean; sortRef: (element: HTMLElement | undefined) => void;
  handleRef: (element: HTMLButtonElement | undefined) => void;
  draggable: boolean;
  onOpenMenu: (x: number, y: number) => void;
}) => {
  const connected = useConnectedProject();
  const pads = createAgentPads(() => props.row.node);
  const copied = createCopyFeedback();
  const unregisterCopy = props.copyWith?.(copied);
  onCleanup(() => unregisterCopy?.());
  let element: HTMLDivElement | undefined;

  const closeName = (restore = true) => { props.onEditing(false);

 if (restore) queueMicrotask(() => element?.focus()); };

  const workstream = () => isWorkstream(props.row.node);
  const cutName = createCutTitle(() => props.row.node.name);

  const kind = (): Kind | null => {
    const kinds = [connected.rail.dismissed(props.row.node) ? "idle" as const : props.row.node.status?.kind, ...(workstream() && props.row.collapsed !== null ? agentKindsBelow(connected.rail.nodes, props.row.node.id) : [])];

    return (["error", "needs-you", "blocked", "working", "done", "idle"] as const).find(kind => kinds.includes(kind)) ?? null;
  };

  const unread = () => connected.unseen.of(props.row.node.id) || (workstream() && props.row.collapsed !== null && connected.unseen.below(props.row.node.id));

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
    "data-editing": props.editing, "data-kind": kind() ?? undefined, "data-lifted": props.lifted,
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

  const row = (mine: (extra: RowProps) => RowProps) => <div {...mine(rowProps())} ref={el => { element = el; props.sortRef(el); }}>
    <Trunks depth={props.row.depth} trail={props.row.trail} stem={props.row.children} />
    <p class="line">
      <Show when={workstream()}><IconButton class="rail-chevron row-control" aria-label={copy.collapse} {...ownKeys} onClick={event => { event.stopPropagation(); props.onToggle(); }}><Icon name={props.row.collapsed ? "right" : "down"} /></IconButton></Show>
      <span class="row-state"><KindGlyph kind={kind() ?? "idle"} /></span>
      {name()}
      <Show when={unread()}><span class="unread-dot row-secondary" data-state="" role="img" aria-label={copy.unreadResult} /></Show>
      <Show when={queuedBadge()}>{badge => <span class="light queue-badge row-secondary">{badge()}</span>}</Show>
      <Show when={!workstream() && props.row.node.worktree}><span class="worktree-chips row-secondary">
        <Show when={(facts()?.ahead ?? 0) > 0}><span class="worktree-chip" role="img" data-state="ahead" aria-label={copy.worktreeAheadState(facts()!.ahead)}>{copy.worktreeAhead(facts()!.ahead)}</span></Show>
        <Show when={facts()?.ci}>{ci => <span class="worktree-chip" role="img" data-state={ci().state} data-stale={ci().stale} aria-label={copy.worktreeCiText(ci().state, ci().stale, true)}>{copy.worktreeCiChip(ci().state)}<Show when={ci().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={facts()?.pr}>{pr => <span class="worktree-chip" role="img" data-state="pr" data-stale={pr().stale} aria-label={copy.worktreePrState(pr().number, pr().stale)}>{copy.worktreePrText(pr().number, false)}<Show when={pr().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={worktreeFailure()}><span class="worktree-chip" data-state="unavailable" role="img" aria-label={copy.worktreeUnavailable}>{copy.worktreeUnavailableMark}</span></Show>
      </span></Show>
      <span class="row-tail">
        <RowIcons actions={props.actions}>{props.doorAction}</RowIcons>
        <Show when={!workstream()}><span class="row-controls"><span class="row-control-slot"><PadsControl pads={pads} agent={props.row.node.id} /></span></span></Show>
        <Show when={props.draggable}><Sortable.Handle label={copy.moveItem(props.row.node.name)} ref={props.handleRef} /></Show>
      </span>
    </p>
    <Show when={!workstream()}><FailureLine status={props.row.node.status} dismissed={connected.rail.dismissed(props.row.node)} /></Show>
  </div>;

  return <>
    <Show when={props.branch} fallback={<TreeView.Item data-id={props.row.node.id} aria-label={[props.row.node.name, ...(workstream() && props.row.node.opening_prompt?.trim() ? [copy.modeWord] : []), ...(!workstream() && props.row.node.status ? [props.row.node.status.label] : [])].join(copy.comma)} asChild={item => row(extra => item(extra))} />}>
      <TreeView.Branch class="rail-root-branch" data-id={props.row.node.id} aria-label={[props.row.node.name, ...(workstream() && props.row.node.opening_prompt?.trim() ? [copy.modeWord] : []), ...(!workstream() && props.row.node.status ? [props.row.node.status.label] : [])].join(copy.comma)}>
        <TreeView.BranchControl asChild={control => row(extra => control(extra))} />
      </TreeView.Branch>
    </Show>
  </>;
};
