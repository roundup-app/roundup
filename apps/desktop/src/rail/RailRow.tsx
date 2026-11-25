import { alertLevel } from "./alertLevel";
import { createCopyFeedback } from "../ui/CopyButton";
import { NameField as NameFieldShared } from "../ui/NameField";
import { openOnRelease } from "../ui/contextMenu";
import { isDoor } from "../state/doorNode";
import { useConnectedProject } from "../state/connectedProject";
import "../keys/styles.css";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { Show, createMemo, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { IconButton } from "../ui/IconButton";
import { TreeItem } from "@ui-sdk/solid/tree";
import { RowIcons } from "./RowIcons";
import type { RowActions } from "./rows";
import { ownKeys } from "./rows";
import { createCutTitle } from "../ui/cutTitle";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Kind } from "@contracts/Kind";
import { Icon } from "../ink/Icon";
import { railAge } from "../shelf/Age";
import { useDisplayNow } from "../state/clock";
import { ProgramStop } from "./ProgramRow";
import { Tip, type TriggerProps } from "../ui/Tip";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { errorCause } from "../ink/FailureLine";
import { isMode } from "./layout";
import { descendantsOf, isWorkstream } from "../state/railTopology";
import { rowKind, rowUnread } from "./rollup";
import { Trunks, tabStop } from "../ui/TreeView";
import type { NodeRow } from "./layout";
import type { RailTopology } from "../state/railTopology";
import { PadsControl } from "./pads/AgentPads";
import { ChangesIcon } from "../changes/ChangesIcon";
import { createRowReveal } from "../ui/rowReveal";

const NameField = (props: { node: RailNode; onCommit: (name: string) => Promise<void>; onFailure: (message: string) => void; onCancel: (restore?: boolean) => void }) =>
  <NameFieldShared object={props.node.id} name={props.node.name} surface="rail-name" plain
    commit={text => props.onCommit(text)} close={props.onCancel} fail={message => { if (message !== null) props.onFailure(copy.failed(copy.rename, message)); }} />;

/** The worktree facts a row carries: ahead count, CI, pull request, or that they are unavailable. */
const WorktreeChips = (props: { id: string }) => {
  const connected = useConnectedProject();
  const read = () => connected.worktrees.read(props.id);
  const worktreeFailure = () => read()?.failure;

  const facts = () => {
    const current = read();

    return current?.failure === null ? current.state : null;
  };

  return <span class="worktree-chips row-secondary" data-no-drag="">
        <Show when={(facts()?.ahead ?? 0) > 0}><span class="worktree-chip" role="img" data-state="ahead" aria-label={copy.worktreeAheadState(facts()!.ahead)}>{copy.worktreeAhead(facts()!.ahead)}</span></Show>
        <Show when={facts()?.ci}>{ci => <span class="worktree-chip" role="img" data-state={ci().state} data-stale={String(ci().stale)} aria-label={copy.worktreeCiText(ci().state, ci().stale, true)}>{copy.worktreeCiGlyph(ci().state)} {copy.ci}<Show when={ci().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={facts()?.pr}>{pr => <span class="worktree-chip" role="img" data-state={pr().draft === undefined ? "pr" : pr().draft ? "draft" : "open"} data-stale={String(pr().stale)} aria-label={pr().draft === undefined ? copy.worktreePrState(pr().number, pr().stale) : [copy.worktreePrState(pr().number, pr().stale), copy.worktreePrKind(pr().draft!)].join(copy.comma)}>{copy.worktreePrText(pr().number, false)}<Show when={pr().draft !== undefined}> {copy.worktreePrKind(pr().draft!)}</Show><Show when={pr().stale}><span class="worktree-stale">{copy.worktreeStale}</span></Show></span>}</Show>
        <Show when={worktreeFailure()}><span class="worktree-chip" data-state="unavailable" role="img" aria-label={copy.worktreeUnavailable}>{copy.worktreeUnavailableMark}</span></Show>
  </span>;
};

/** U7205d: the Machine of an Agent on another Machine as one server icon in its fixed slot; the name, or offline, is its Tooltip and accessible name. An Agent on this Mac shows nothing. */
const MachineIcon = (props: { node: RailNode }) => {
  const connected = useConnectedProject();
  const machine = () => props.node.kind === "agent" && props.node.status !== null ? props.node.machine : undefined;
  const text = (name: string) => connected.machines.offline(name) ? copy.machineOffline : name;

  return <Show when={machine()}>{name => <span class="row-slot row-machine">
    <Tip kind="changing" text={text(name())}>{trigger => <span {...trigger()} class="machine-icon" data-offline={connected.machines.offline(name()) ? "" : undefined} role="img" aria-label={text(name())}><Icon name="server" /></span>}</Tip>
  </span>}</Show>;
};

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

/** The control that folds or unfolds a row's children. */
const FoldControl = (props: { class: string; collapsed: boolean; onToggle: () => void }) => (
  <IconButton icon="expand" class={props.class} aria-label={props.collapsed ? copy.expand : copy.collapse} aria-expanded={props.collapsed ? "false" : "true"} {...ownKeys} onClick={event => { event.stopPropagation(); props.onToggle(); }}><Icon name={props.collapsed ? "right" : "down"} /></IconButton>
);

const StateDot = (props: { kind: Kind; text: string; markable: boolean; onMark: (event: MouseEvent) => void; onFocusHandlers: (focus: Pick<TriggerProps, "onFocusIn" | "onFocusOut">) => void }) => (
  <Tip kind="changing" text={props.markable ? copy.markDone : props.text}>{(trigger, focus) => {
    props.onFocusHandlers(focus);

    return <Show when={props.markable} fallback={<span {...trigger()} class="row-state"><KindGlyph kind={props.kind} label={props.text} /></span>}>
      <button {...trigger({ onClick: props.onMark })} type="button" class="row-state row-mark" aria-label={copy.markDone}><KindGlyph kind="needs-you" label={copy.markDone} /></button>
    </Show>;
  }}</Tip>
);

export const RailRowView = (props: {
  actions: RowActions; doorAction?: JSX.Element;
  topology: RailTopology; todos: { done: number; total: number }; selected: boolean;
  row: NodeRow; rootDivider?: boolean; multiple: boolean; tabbable: boolean; branch: boolean;
  copyWith?: (feedback: ReturnType<typeof createCopyFeedback>) => () => void;
  editing: boolean; onEditing: (editing: boolean) => void; onToggle: () => void; onOpen: (id?: string) => void;
  onRename: (name: string) => Promise<void>; onFailure: (message: string) => void;
  lifted: boolean; /** U6550a: the drag holds this row and its children are folded under it. */ folded: boolean; sortRef: (element: HTMLElement | undefined) => void;
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
  // U4547a, U7594a: a Mode folds the Agents it started, as a Workstream folds its own.
  const folds = () => workstream() || isMode(props.row.node) && props.branch;
  const isContainer = () => workstream() || isGroup();

  // U3800d: each derived value is a memo, so a move that changes none of them runs nothing below it.
  const kind = createMemo((): Kind | null => rowKind(props.topology, props.row.node, node => connected.rail.dismissed(node), props.row.collapsed !== null));

  /** DCL1, U6249d: the first Agent, the row's own, or any below it while the row is folded, whose Messages have not reached it, with the Daemon's cause. An open Workstream adds nothing: its child's own row shows the line. */
  const unreachable = () => [props.row.node, ...(props.row.collapsed ? descendantsOf(props.topology, props.row.node.id) : [])].filter(isDoor).find(node => node.unreachable);

  const waiting = () => props.row.node.kind === "workstream" ? props.row.node.waiting : undefined;
  const door = () => isDoor(props.row.node) ? props.row.node : undefined;
  const doorStatus = () => door()?.status;
  const worktree = () => door()?.worktree;

  // U7371b/c: an Agent's Worktree holds only main's work; a Workstream is finished once every Agent under it is.
  const finished = createMemo(() => {
    if (!workstream()) return !!worktree() && connected.worktrees.finished(props.row.node.id);

    const agents = descendantsOf(props.topology, props.row.node.id).filter(node => isDoor(node) && !isWorkstream(node));

    return agents.length > 0 && agents.every(node => connected.worktrees.finished(node.id));
  });

  const resumeWait = () => door()?.resume;

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

    return connected.rail.resumeTurn(props.row.node.id).then(failed => { if (failed !== null) props.onFailure(copy.failed(copy.resume, failed)); });
  };

  let glyphFocus: Pick<TriggerProps, "onFocusIn" | "onFocusOut"> | undefined;

  // The row takes keyboard focus for its glyph, so the glyph's Tooltip opens on it as well.
  const glyphFocusOn = (event: FocusEvent, handler: JSX.EventHandlerUnion<HTMLElement, FocusEvent> | undefined) => {
    const { target, currentTarget } = event;

    if (target !== currentTarget || !(currentTarget instanceof HTMLElement) || !(target instanceof Element) || !(handler instanceof Function)) return;
    // SAFETY: the guards above narrow currentTarget to an HTMLElement and target to an Element, the event type the handler takes.
    handler(event as FocusEvent & { currentTarget: HTMLElement; target: Element });
  };

  const unread = createMemo(() => rowUnread(props.topology, props.row.node, id => connected.unseen.of(id), props.row.collapsed !== null));
  const level = createMemo(() => alertLevel(props.topology, props.row.node));
  const multiple = createMemo(() => props.multiple);
  const tabbable = createMemo(() => props.tabbable);
  const rootDivider = createMemo(() => props.rootDivider ?? false);
  const pending = createMemo<"true" | undefined>(() => connected.rail.pendingOf(props.row.node.id) ? "true" : undefined);

  const queuedBadge = () => {
    const queued = workstream() ? connected.queue.entryOf(props.row.node.id) : null;

    return queued ? queued.entry.start.kind === "afterTodo" ? copy.afterBadge(queued.entry.start.todo) : copy.queuedBadge(queued.place) : null;
  };

  const reveal = createRowReveal(() => props.selected);

  const rowProps = () => ({
    class: rootDivider() ? "rail-row row-wash rail-root-divider" : "rail-row row-wash", "data-id": props.row.node.id,
    title: !props.editing ? cutName.title() : undefined,
    "data-multiple": multiple() ? "true" : undefined,
    "data-mode": isMode(props.row.node) ? "true" : undefined,
    "data-finished": finished() ? "true" : undefined,
    "data-editing": String(props.editing), "aria-busy": pending(), "data-kind": kind() ?? undefined, "data-lifted": String(props.lifted),
    style: { "--tree-depth": props.row.depth, "--indent": `calc(${props.row.depth} * var(--rail-step) + var(--rail-inset))` },
    onDblClick: (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("button, input") || props.lifted) return;
      props.onEditing(true);
    },
    "data-reveal": reveal["data-reveal"],
    onPointerEnter: reveal.onPointerEnter,
    onPointerLeave: reveal.onPointerLeave,
    onFocusIn: (event: FocusEvent) => { reveal.onFocusIn(); glyphFocusOn(event, glyphFocus?.onFocusIn); },
    onFocusOut: (event: FocusEvent) => { reveal.onFocusOut(event); glyphFocusOn(event, glyphFocus?.onFocusOut); },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.target !== event.currentTarget || event.key !== "F2" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      event.preventDefault(); event.stopPropagation(); props.onEditing(true);
    },
    onContextMenu: (press: MouseEvent) => openOnRelease(press, (x, y) => props.onOpenMenu(x, y)),
  });

  const name = () => <Show when={props.editing} fallback={<span id={`rail-name-${props.row.node.id}`} class="name" ref={cutName.ref}>{copied.copied() ? copy.copied : props.row.node.name}</span>}>
    <NameField node={props.row.node} onCommit={props.onRename} onFailure={props.onFailure} onCancel={closeName} />
  </Show>;

  // U7915a: a dot with no fold arrow and a `needs-you` not yet marked done clears that mark on one click, and nothing else.
  const markable = () => !folds() && !isGroup() && doorStatus()?.kind === "needs-you" && !connected.rail.dismissed(props.row.node);
  const markDone = (event: MouseEvent) => { event.stopPropagation(); connected.rail.dismiss(props.row.node); };

  const choose = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.lifted) return;

    if (!(event.target instanceof Element) || event.target.closest("button, input, a, [contenteditable]")) return;
    // The tree focuses a pressed row after this handler; a pointer has focused it already. Doing it first keeps that focus move from voiding the choice's own permission to focus the Terminal.
    element?.focus({ preventScroll: true });
    props.onOpen();
  };

  const label = () => [props.row.node.name, ...(isMode(props.row.node) ? [copy.modeWord] : []), ...(!workstream() && doorStatus() ? [statusLabel()] : [])].join(copy.comma);

  return <TreeItem value={props.row.node.id} aria-label={label()} {...rowProps()} onClick={choose} ref={el => { element = el; props.sortRef(el); }} render={tabStop(tabbable)}>
    <Trunks depth={props.row.depth} trail={props.row.trail} stem={props.row.children} />
    <p class="line">
      <Show when={folds()}><FoldControl class="rail-chevron row-control" collapsed={!!props.row.collapsed} onToggle={props.onToggle} /></Show>
      <StateDot kind={kind() ?? "idle"} text={glyphText()} markable={markable()} onMark={markDone} onFocusHandlers={focus => { glyphFocus = focus; }} />
      <span class="name-group">{name()}<Show when={!workstream() && worktree()}><WorktreeChips id={props.row.node.id} /></Show></span>
      <Show when={level() !== "default" && level()}>{level => <span class="alert-level" data-state="alert-level">{level()}</span>}</Show>
      <FoldedCount folded={props.folded} topology={props.topology} id={props.row.node.id} hidden={props.row.collapsed?.agents.length} />
      <Show when={unread()}><span class="unread-dot row-secondary" data-state="" role="img" aria-label={copy.unreadResult} /></Show>
      <Show when={queuedBadge()}>{badge => <span class="light queue-badge row-secondary">{badge()}</span>}</Show>
      <Show when={!isGroup()}><MachineIcon node={props.row.node} /></Show>
      <Show when={unreachable()}>{reached => <BusyButton kind="quiet" class="rail-unreachable" busyLabel={retry() ? copy.retrying : copy.opening} aria-label={`${reachLabel()} ${reached().name}`} onClick={reachAct}>{reachLabel()}</BusyButton>}</Show>
      <Show when={!workstream() && resumeWait() && !resumeWait()?.at && doorStatus()?.kind === "error"}><BusyButton kind="quiet" class="rail-resume" busyLabel={copy.resuming} aria-label={copy.resumeAgent(props.row.node.name)} onClick={resumeAct}>{copy.resume}</BusyButton></Show>
      <span class="row-tail">
        <Show when={!isGroup()}>
          <span class="action-slot" data-slot="todos"><Show when={!isContainer()}><PadsControl todos={props.todos} agent={props.row.node.id} /></Show></span>
          <span class="action-slot" data-slot="changes"><Show when={!isContainer()}><ChangesIcon id={props.row.node.id} /></Show></span>
          <RowIcons actions={props.actions}>{props.doorAction}<ProgramStop id={props.row.node.id} /></RowIcons>
        </Show>
        <Show when={isGroup()}><FoldControl class="rail-group-chevron" collapsed={!!props.row.collapsed} onToggle={props.onToggle} /></Show>
      </span>
      <RowAge since={doorStatus()?.since} />
    </p>
  </TreeItem>;
};
