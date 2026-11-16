import { alertLevel } from "./alertLevel";
import { Sortable } from "../ui/sortable";
import { createCopyFeedback } from "../ui/CopyButton";
import { applying } from "../app/pending";
import { captureFocus, queueFocus } from "../keys/focus";
import { ReservedLine } from "../ink/ReservedLine";
import { openOnRelease } from "../ui/contextMenu";
import * as v from "valibot";
import { isDoor } from "../state/doorNode";
import { useConnectedProject } from "../state/connectedProject";
import "../keys/styles.css";
import { copy } from "./copy";
import { Show, createMemo, onCleanup, untrack, type JSX } from "solid-js";
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
import { LABELS } from "../ink/KindGlyph";
import { railAge } from "../shelf/Age";
import { useDisplayNow } from "../state/clock";
import { Tip, type TriggerProps } from "../ui/Tip";
import { KindGlyph } from "../ink/KindGlyph";
import { errorCause } from "../ink/FailureLine";
import { isMode } from "./layout";
import { descendantsOf, isWorkstream } from "../state/railTopology";
import { rowKind, rowUnread } from "./rollup";
import { Trunks } from "../ui/TreeView";
import type { NodeRow } from "./layout";
import type { RailTopology } from "../state/railTopology";
import { PadsControl } from "./pads/AgentPads";
import { createDraftField } from "../state/draftField";

/** What Ark's item and branch control take for the row's own element. */
type RowProps = JSX.HTMLAttributes<HTMLDivElement>;

const nameSchema = v.object({ text: v.string(), base: v.string() });

const caretOf = (field: HTMLInputElement) => ({ start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" });

const NameField = (props: { node: RailNode; onCommit: (name: string) => Promise<void>; onFailure: (message: string) => void; onCancel: (restore?: boolean) => void }) => {
  const connected = useConnectedProject();
  // The field renames the row it opened on through the handler it was given.
  const { id, rename } = untrack(() => ({ id: props.node.id, rename: props.onCommit }));
  const destination = { surface: "rail-name", object: id, recipient: null };
  const draft = createDraftField(connected.drafts, destination, nameSchema);
  const current = draft.draft;

  const value = () => {
    const text = current()?.value.text;

    return v.is(v.string(), text) ? text : props.node.name;
  };

  const capture = (field: HTMLInputElement) => draft.keep({ text: field.value, base: String(current()?.value.base ?? props.node.name) }, caretOf(field));

  const conflict = () => current() !== undefined && current()?.status !== "pending" && current()?.value.base !== props.node.name;

  const commit = async (field: HTMLInputElement) => {
    if (conflict()) return;
    capture(field);
    const name = value().trim();

    if (name === "") {
      props.onCancel();

      return;
    }

    // Enter is the owner's own send, so a recovered name goes too.
    draft.save();
    const sent = await draft.send(() => applying(() => rename(name)));

    if (sent.kind === "applied" && current()?.status !== "draft") props.onCancel();
    else if (sent.kind === "refused") props.onFailure(copy.failed(copy.rename, sent.error.message));
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
      onInput={(event) => capture(event.currentTarget)}
      onSelect={(event) => { if (event.currentTarget.isConnected && current()?.status === "draft") capture(event.currentTarget); }}
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

/** U7205d: the Machine of an Agent on another Machine as one server icon in its fixed slot; the name, or offline, is its Tooltip and accessible name. An Agent on this Mac shows nothing. */
const MachineIcon = (props: { node: RailNode }) => {
  const connected = useConnectedProject();
  const machine = () => props.node.kind === "agent" && props.node.status !== null ? props.node.machine : undefined;
  const text = (name: string) => connected.machines.offline(name) ? copy.machineOffline : name;

  return <Show when={machine()}>{name => <span class="row-slot row-machine">
    <Tip text={text(name())}>{trigger => <span {...trigger()} class="machine-icon" data-offline={connected.machines.offline(name()) ? "" : undefined} role="img" aria-label={text(name())}><Icon name="server" /></span>}</Tip>
  </span>}</Show>;
};

/** U7205e: who started the row as one icon in its fixed slot; the full text is its Tooltip and accessible name. */
const AttributionIcon = (props: { text: string }) => <span class="row-slot row-attribution">
  <Tip text={props.text}>{trigger => <span {...trigger()} class="attribution-icon" role="img" aria-label={props.text}><Icon name="started" /></span>}</Tip>
</span>;

/** U7205c: the age in the row's one trailing slot. */
const RowAge = (props: { since: number | undefined }) => {
  const now = useDisplayNow(() => false);

  return <span class="row-age">{props.since === undefined ? "" : railAge(props.since, now())}</span>;
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
  const unreachable = () => [props.row.node, ...(isContainer() && props.row.collapsed ? descendantsOf(props.topology, props.row.node.id) : [])].filter(isDoor).find(node => node.unreachable);

  const waiting = () => props.row.node.kind === "workstream" ? props.row.node.waiting : undefined;
  const door = () => isDoor(props.row.node) ? props.row.node : undefined;
  const doorStatus = () => door()?.status;
  const worktree = () => door()?.worktree;
  const resumeWait = () => door()?.resume;
  const attribution = () => door()?.start_attribution;

  const statusLabel = () => {
    const status = doorStatus();

    return status?.kind === "error" && connected.rail.dismissed(props.row.node) ? copy.dismissedFailure(status.label) : status?.label ?? "";
  };

  /** U7205a, U7205b: the reasons that once took a second line (waiting Door, unreachable Agent, resume wait, Door failure) as Tooltip words. */
  const reasons = (): string[] => {
    const count = workstream() && !connected.rail.launching(props.row.node.id) ? waiting() : undefined;
    const reached = unreachable();
    const resume = !workstream() ? resumeWait() : undefined;
    const failure = workstream() ? connected.rail.doorFailure(props.row.node.id) : undefined;

    return [
      count ? copy.doorStoppedWaiting(count) : "",
      reached ? copy.cantReach(reached.name, reached.unreachable!) : "",
      resume?.at ? copy.resumesAt(doorStatus()?.label ?? "", resume.at) : "",
      failure || "",
    ].filter(Boolean);
  };

  // U7205a: the glyph's Tooltip and accessible name carry the status words, an error's reason included; the row shows none.
  const glyphText = () => {
    const shown = kind() ?? "idle";
    const status = doorStatus();
    const cause = errorCause(status, connected.rail.dismissed(props.row.node));

    return [LABELS[shown], cause ?? (statusLabel().toLowerCase() !== LABELS[shown].toLowerCase() ? statusLabel() : ""), ...reasons()].filter(Boolean).join(copy.comma);
  };

  // DCL1a: only the Agent's transcript can be inspected for an unreadable one; every other cause offers another delivery pass.
  const retry = () => unreachable()?.unreachable !== "transcript unreadable";
  const reachLabel = () => retry() ? copy.retryUnreachable() : copy.openUnreachable();

  const reachAct = async (event: MouseEvent) => {
    const reached = unreachable();

    event.stopPropagation();

    if (!reached) return;

    if (!retry()) return props.onOpen(reached.id);

    const failed = await connected.rail.retryDelivery(reached.id);

    if (failed !== null) props.onFailure(copy.failed(reachLabel(), failed));
  };

  const resumeAct = (event: MouseEvent) => {
    event.stopPropagation();
    void connected.rail.resumeTurn(props.row.node.id).then(failed => { if (failed !== null) props.onFailure(copy.failed(copy.resume, failed)); });
  };

  let glyphFocus: Pick<TriggerProps, "onFocusIn" | "onFocusOut"> | undefined;

  // The row takes keyboard focus for its glyph, so the glyph's Tooltip opens on it as well.
  const glyphFocusOn = (event: FocusEvent, handler: JSX.EventHandlerUnion<HTMLElement, FocusEvent> | undefined) => {
    const { target, currentTarget } = event;

    if (target !== currentTarget || !(currentTarget instanceof HTMLElement) || !(target instanceof Element) || !(handler instanceof Function)) return;
    // SAFETY: the guards above narrow currentTarget to an HTMLElement and target to an Element, the event type the handler takes.
    handler(event as FocusEvent & { currentTarget: HTMLElement; target: Element });
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

  const rowProps = () => ({
    class: "rail-row", classList: { "row-wash": true, "rail-root-divider": rootDivider() }, "data-id": props.row.node.id,
    title: !props.editing ? cutName.title() : undefined,
    "data-selected": selected() ? "true" : undefined,
    "data-multiple": multiple() ? "true" : undefined,
    tabIndex: tabbable() ? 0 : -1,
    "data-mode": isMode(props.row.node) ? "true" : undefined,
    "data-worktree": worktree() ? "true" : undefined,
    "data-editing": props.editing, "aria-busy": pending(), "data-kind": kind() ?? undefined, "data-lifted": props.lifted,
    style: { "--tree-depth": props.row.depth, "--indent": `calc(${props.row.depth} * var(--rail-step) + var(--rail-inset))` },
    onDblClick: (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("button, input") || props.lifted) return;
      props.onEditing(true);
    },
    onFocusIn: (event: FocusEvent) => glyphFocusOn(event, glyphFocus?.onFocusIn),
    onFocusOut: (event: FocusEvent) => glyphFocusOn(event, glyphFocus?.onFocusOut),
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
      <Tip text={glyphText()}>{(trigger, focus) => {
        glyphFocus = focus;

        return <span {...trigger()} class="row-state"><KindGlyph kind={kind() ?? "idle"} label={glyphText()} /></span>;
      }}</Tip>
      {name()}
      <Show when={level() !== "default" && level()}>{level => <span class="alert-level" data-state="alert-level">{level()}</span>}</Show>
      <FoldedCount folded={props.folded} topology={props.topology} id={props.row.node.id} hidden={props.row.collapsed?.agents.length} />
      <Show when={unread()}><span class="unread-dot row-secondary" data-state="" role="img" aria-label={copy.unreadResult} /></Show>
      <Show when={queuedBadge()}>{badge => <span class="light queue-badge row-secondary">{badge()}</span>}</Show>
      <Show when={!workstream() && worktree()}><WorktreeChips id={props.row.node.id} /></Show>
      <Show when={attribution()}>{source => <AttributionIcon text={copy.startedBy(source().agent_name, source().project_name)} />}</Show>
      <Show when={!isGroup()}><MachineIcon node={props.row.node} /></Show>
      <Show when={unreachable()}>{reached => <button type="button" class="rail-unreachable" data-button="quiet" aria-label={`${reachLabel()} ${reached().name}`} onClick={reachAct}>{reachLabel()}</button>}</Show>
      <Show when={!workstream() && resumeWait() && !resumeWait()?.at && doorStatus()?.kind === "error"}><button type="button" class="rail-resume" data-button="quiet" aria-label={copy.resumeAgent(props.row.node.name)} onClick={resumeAct}>{copy.resume}</button></Show>
      <span class="row-tail">
        <Show when={!isGroup()}><RowIcons actions={props.actions}>{props.doorAction}</RowIcons></Show>
        <Show when={!isContainer()}><span class="row-controls"><span class="row-control-slot"><PadsControl count={props.todoCount} agent={props.row.node.id} /></span></span></Show>
        <Show when={props.draggable}><Sortable.Handle label={copy.moveItem(props.row.node.name)} ref={props.handleRef} /></Show>
        <Show when={isGroup()}><IconButton class="rail-group-chevron" aria-label={props.row.collapsed ? copy.expand : copy.collapse} aria-expanded={!props.row.collapsed} {...ownKeys} onClick={event => { event.stopPropagation(); props.onToggle(); }}><Icon name={props.row.collapsed ? "right" : "down"} /></IconButton></Show>
      </span>
      <RowAge since={doorStatus()?.since} />
    </p>
  </div>;

  return <>
    <Show when={props.branch} fallback={<TreeView.Item data-id={props.row.node.id} aria-label={[props.row.node.name, ...(isMode(props.row.node) ? [copy.modeWord] : []), ...(!workstream() && doorStatus() ? [statusLabel()] : [])].join(copy.comma)} asChild={item => row(extra => item(extra))} />}>
      <TreeView.Branch class="rail-root-branch" data-id={props.row.node.id} aria-label={[props.row.node.name, ...(isMode(props.row.node) ? [copy.modeWord] : []), ...(!workstream() && doorStatus() ? [statusLabel()] : [])].join(copy.comma)}>
        <TreeView.BranchControl asChild={control => row(extra => control(extra))} />
      </TreeView.Branch>
    </Show>
  </>;
};
