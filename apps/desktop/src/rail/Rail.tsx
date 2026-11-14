import { useTodoList } from "../todos/todoList";
import { usePadList } from "../pads/padList";
import { createAgentPads } from "./pads/AgentPads";
import { createMove, MovePicker } from "./MovePicker";
import { WorkProgress } from "../orders/WorkProgress";
import { EmptyRail } from "./EmptyRail";
import { failureOf } from "../app/failureOf";
import { captureFocus, returnFocus } from "../keys/focus";
import { type createCopyFeedback } from "../ui/CopyButton";
import * as v from "valibot";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, on, Show, untrack } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { SectionHead } from "../ink/SectionHead";
import { KindGlyph } from "../ink/KindGlyph";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ink/Icon";
import { CHORDS, type ActionValue } from "../keys/chords";
import { captureActions, registerKeys } from "../keys/registry";
import { Sortable, type SortableMove } from "../ui/sortable";
import { TreeView, Trunks } from "../ui/TreeView";
import { useTreeView } from "@ark-ui/solid/tree-view";
import { useConnectedProject } from "../state/connectedProject";
import { doorStateOf } from "./doorState";
import { RailDialogs, type RailDialog } from "./dialogs";
import { RailConfirm } from "./menu/RailConfirm";
import { createRailMenu } from "./menu/model";
import { offered } from "./menu/entries";
import { isMode } from "./layout";
import { ancestorsOf, descendantsOf, isWorkstream, siblingsOf } from "../state/railTopology";
import { RailRowView } from "./RailRow";
import { focusedRowId, keyedRowIdAt, ROW, rowIdAt, strandedRow, type RowActions } from "./rows";
import { strandedRowKeys } from "./strandedKeys";
import { SpawnPromptField } from "./SpawnPromptField";
import type { RailNode } from "@contracts/agent/RailNode";
import { contextMenu, openOnRelease, type MenuEntry } from "../ui/contextMenu";
import { useRecoveryMenu } from "../drawer/DraftRecovery";
import { draftsOf } from "../state/railStorage";
import { createRailDrag } from "./drag";
import { createWritableMemo } from "@solid-primitives/memo";
import { makeEventListener } from "@solid-primitives/event-listener";
import { afterElseBefore } from "../keys/survivor";
import { createRailTree, sameList, sections } from "./railTree";
import { RailRecovery } from "./RailRecovery";
import { RailFooter } from "./RailFooter";
import { createLaunch, railCommand } from "./railCommands";
import { createDraftField } from "../state/draftField";
import "./styles.css";

const taskSchema = v.object({ text: v.string(), parent: v.nullable(v.string()), model: v.null(), effort: v.null(), action: v.picklist(["note", "spawn"]) });

type Destination = Parameters<typeof createDraftField>[1];

const sameDestination = (a: Destination, b: Destination) => a.surface === b.surface && a.object === b.object && a.recipient === b.recipient;

const toggled = <T,>(set: ReadonlySet<T>, member: T): ReadonlySet<T> =>
  new Set(set.has(member) ? [...set].filter((each) => each !== member) : [...set, member]);

/** macOS Ctrl-click opens the menu: its press and its compatibility click, which may come without ctrlKey, must not focus, toggle or open a row. */
const ctrlClickGuard = () => {
  let armed = false;

  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    press: (event: PointerEvent) => {
      armed = event.button === 0 && event.ctrlKey;

      if (armed) swallow(event);
    },
    click: (event: MouseEvent) => {
      if (!armed && !event.ctrlKey) return;

      armed = false;
      swallow(event);
    },
    // A native menu may consume the compatibility click; the next key activates as usual.
    disarm: () => { armed = false; },
  };
};

export const Rail = (props: { collapse?: () => void; peeked?: boolean } = {}) => {
  const connected = useConnectedProject();
  const { app, project, rail, daemonExit } = connected;

  const recoveryEntries = useRecoveryMenu();

  const todoCount = createAgentPads();
  const collapsed = rail.collapsed;
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string | null>>(new Set());
  const failure = rail.commandFailure;
  const retained = draftsOf(connected.drafts);
  // #2788: avoid rescanning all drafts per recovery row; 10k lookups took 527 ms with find, 0.6 ms with Map.
  const revisions = createMemo(() => new Map(retained.records().map((draft) => [draft.revision, draft])));

  const [dialog, setDialog] = createSignal<RailDialog | null>(null);
  const copied = new Map<string, ReturnType<typeof createCopyFeedback>>();

  const shownFailure = (id: string | undefined) => rail.nodes.find(node => node.id === id && node.kind === "agent" && node.status?.kind === "error" && !rail.dismissed(node));

  const moveAgent = createMove(connected, id => rowElement(id));

  const knownTodos = useTodoList();
  const knownPads = usePadList();

  const menu = createRailMenu({
    app, rail, onFailure: failure.show, acknowledge: failure.acknowledge, storage: connected.drafts, queue: connected.queue,
    rename: id => { setEditingName(id); },
    extra: node => {
      const actions = actionsOf(node);

      return offered([
        { when: node.kind === "agent" && node.status?.kind === "error" && !rail.dismissed(node), id: "dismiss", label: copy.dismissError, run: () => { rail.dismiss(node); } },
        { when: moveAgent.available(node.id), id: "move", label: copy.moveTo, shortcut: "M", run: () => moveAgent.open(node.id) },
        { when: node.can_make_workstream, id: "make-workstream", label: copy.makeWorkstream, run: () => { void menu.makeWorkstream(node); } },
        { when: node.can_save_as_mode, id: "save-as-mode", label: copy.saveAsMode, run: () => { setDialog({ kind: "save-as-mode", id: node.id }); } },
        { when: isMode(node), id: "restart", label: copy.restart, shortcut: "R", run: () => { void menu.restartMode(node.id); } },
        {
          when: node.kind === "agent" && node.status !== null || node.kind === "workstream" && node.attempt !== null,
          id: "progress", label: copy.workProgress, run: () => {
            rowElement(node.id)?.focus({ preventScroll: true });
            connected.drawer.open(() => <WorkProgress id={node.id} />, "key", { kind: "progress", project: project.path });
          },
        },
        { when: isMode(node), id: "mode-prompt", label: copy.modePromptMenu, run: () => { setDialog({ kind: "opening-prompt", id: node.id }); } },
        { id: "folder", label: copy.openFolder, run: actions.folder },
        { id: "editor", label: copy.openInEditor, run: actions.editor },
        { when: actions.kind === "workstream", id: "add", label: copy.addMenu, children: [
          { id: "add-todo", label: copy.todo, enabled: daemonExit() === null, run: () => connected.createIn("todo", node.id) },
          { id: "add-pad", label: copy.pad, enabled: daemonExit() === null, run: () => connected.createIn("pad", node.id) },
          { id: "add-terminal", label: copy.addTerminalMenu, enabled: daemonExit() === null, run: () => connected.createIn("terminal", node.id) },
        ] },
        { when: actions.kind === "workstream" && rail.exitOf(node) !== null && !connected.queue.entryOf(node.id), id: "start", label: rail.doorFailure(node.id) ? copy.retryDoor : copy.startDoor, enabled: !rail.launching(node.id), run: () => { failure.clear(); rail.clearWorkstreamFailure(); void rail.startDoor(node.id); } },
      ]);
    },
    feedback: id => copied.get(id),
    known: () => knownTodos.isLoaded() && !knownTodos.failure() && knownPads.loaded() && !knownPads.failure() ? { todos: knownTodos.all(), pads: knownPads.pads() } : null,
  });


  const [wanted, setWanted] = createSignal<{ id: string; focus: ReturnType<typeof captureFocus> } | null>(null);
  /** Gates `⌘N` in the chord handler and the add-agent click below, so an open field is never dropped mid-type (U33). */
  const [composing, setComposing] = createSignal(false);
  const [editingName, setEditingName] = createSignal<string | null>(null);
  const [taskDestination, setTaskDestination] = createSignal<string | null>(null);
  const task = () => retained.records().filter((entry) => entry.destination.surface === "rail-task").at(-1);

  const recovery = createMemo(() => retained.records().filter((entry) => {
    const { surface, object } = entry.destination;

    if (!surface.startsWith("rail-")) return false;

    if (surface === "rail-task" && composing() && entry.revision === task()?.revision) return false;

    if (surface === "rail-name" && object === editingName() && rail.nodes.some(node => node.id === object)) {
      return entry.revision !== retained.records().filter((draft) => draft.destination.surface === surface && draft.destination.object === object).at(-1)?.revision;
    }

    return true;
  }));

  const destinationName = (id: string) => id === "" || id === project.path ? copy.overview : rail.nodes.find((node) => node.id === id)?.name ?? copy.railDraftMissingTarget;

  const draft = () => {
    const text = task()?.value.text;

    return v.is(v.string(), text) ? text : "";
  };

  const taskParent = () => {
    const saved = task();

    if (!saved) return taskDestination();

    if (v.is(v.nullable(v.string()), saved.value.parent)) return saved.value.parent;

    return saved.destination.object === "" || saved.destination.object === project.path ? null : saved.destination.object;
  };

  const taskAction = () => {
    const saved = task();

    if (saved) return v.is(v.picklist(["note", "spawn"]), saved.value.action) ? saved.value.action : saved.destination.recipient === null ? "spawn" : "note";

    const original = rail.nodes.find((node) => node.id === taskDestination());

    return original !== undefined && doorStateOf(original, rail.exitOf(original), rail.launching(original.id), rail.doorFailure(original.id) !== null) === null ? "note" : "spawn";
  };

  const composeDestination = createMemo((): Destination => {
    const under = taskParent();

    return task()?.destination ?? { surface: "rail-task", object: under ?? project.path, recipient: taskAction() === "note" ? under : null };
  }, undefined, { equals: sameDestination });

  const compose = createMemo(on(composeDestination, destination => createDraftField(connected.drafts, destination, taskSchema)));

  const keepDraft = (text: string, selection = task()?.selection ?? null) =>
    compose().keep({ text, parent: taskParent(), model: null, effort: null, action: taskAction() }, selection);

  let composeOpener: Element | null = null;

  const openCompose = (prompt?: ActionValue) => {
    captureFocus(true);

    if (!composing()) { composeOpener = document.activeElement; setTaskDestination(parent()); }

    setComposing(true);

    if (prompt !== undefined) keepDraft(String(prompt));
  };

  const endCompose = () => setComposing(false);

  const { topology, sectionRows, rows, collection, settleCollection, expanded, entryOf, nodeRows, nodeIds, indexOf, treeRows, byKey, lifted, dropRules } = createRailTree(connected, unfolded, id => rowElement(id), () => container());


  /** U38: mounting follows the first tree answer; fetch failure takes precedence. */
  const isEmpty = () => rail.nodes.length === 0 && rail.failure() === null;


  const [container, setContainer] = createSignal<HTMLElement>();
  const [field, setField] = createSignal<HTMLTextAreaElement>();

  /** The focusable element of the row `id`: its item, or the control of its branch. */
  const rowElement = (id: string) => container()?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.closest<HTMLElement>(ROW) ?? container()?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-part="branch-control"]`) ?? undefined;

  const [focused, setFocused] = createSignal<string | null>(null);
  createEffect(on(rows, current => {
    const id = focused();

    if (!id || document.activeElement !== document.body && !container()?.contains(document.activeElement)) return;
    const visible = current.some(row => row.kind === "node" ? row.node.id === id : row.key === id);

    if (visible) return;
    const ancestors = id.startsWith("fold:") ? [id.slice(5).replace(/^internal:/, ""), ...ancestorsOf(topology(), id.slice(5).replace(/^internal:/, ""))] : ancestorsOf(topology(), id);
    const parent = ancestors.find(ancestor => current.some(row => row.kind === "node" && row.node.id === ancestor));

    if (!parent) {
      // U5991a: a row that left at once takes its focus with it; the first row left keeps the Rail's key history.
      queueMicrotask(() => {
        const active = document.activeElement;

        // Focus already moved to a surviving row (the removal's own advance): leave it.
        if (active instanceof HTMLElement && active !== document.body && container()?.contains(active) && active.isConnected) return;
        container()?.querySelector<HTMLElement>(ROW)?.focus();
      });

      return;
    }

    const branch = id.startsWith("fold:") ? undefined : current.find(row => row.kind === "fold" && row.parent === parent &&
      row.group === (rail.nodes.find(node => node.id === id)?.visibility === "internal" ? "internal" : "idle"));

    const target = branch?.key ?? parent;
    setFocused(target);
    // U3800g: the restore runs at the next frame, after the drop's task.
    requestAnimationFrame(() => rowElement(target)?.focus());
  }));

  const openRow = (id: string) => {
    const node = rail.nodes.find(each => each.id === id);

    const attention = node?.kind === "workstream" && node.status?.kind !== "needs-you"
      ? rail.nodes.find(each => each.status?.kind === "needs-you" && ancestorsOf(topology(), each.id).includes(id)) : undefined;

    const destination = attention?.id ?? id;
    setSelected([destination]);
    rail.select(destination);
  };

  // The rows chosen: Zag's tree-view owns range, toggle, select-all and typeahead; opening a row replaces them.
  const [selected, setSelected] = createWritableMemo<string[]>(() => rail.selected() === null ? [] : [rail.selected()!]);
  const isSelected = (id: string) => selected().includes(id);

  /** A drawn, enabled data row: Zag's select-all also takes section and fold branches and the rows a closed branch holds. */
  const selectable = (value: string) => rail.nodes.some(node => node.id === value) && rowElement(value)?.closest("[hidden], [inert], [aria-disabled=true]") === null;

  const tree = useTreeView(() => ({
    collection: collection(),
    focusedValue: focused(),
    onFocusChange: details => setFocused(details.focusedValue),
    expandedValue: expanded(),
    selectionMode: "multiple",
    typeahead: true,
    selectedValue: selected(),
    onSelectionChange: details => setSelected(details.selectedValue.filter(selectable)),
    expandOnClick: false,
    onExpandedChange: details => {
      const open = new Set(details.expandedValue);

      for (const id of collection().getBranchValues()) {
        const section = sections.find(section => `section:${section.id}` === id);

        if (section) rail.setSectionOpen(section.id, open.has(id));
        else if (id.startsWith("fold:")) {
          const parent = id.slice(5);

          if (open.has(id) !== unfolded().has(parent)) setUnfolded(current => toggled(current, parent));
        }
        else if (open.has(id) === collapsed().has(id)) rail.toggleCollapsed(id);
      }
    },
  }));

  const focusRow = (id: string) => tree().focus(id);

  const selectedNodes = () => nodeRows().flatMap(row => isSelected(row.node.id) ? [row.node] : []);

  const removeSelection = (chosen = selectedNodes()) => {
    const before = nodeIds();
    const last = Math.max(...chosen.map(node => before.indexOf(node.id)));
    void menu.requestRemoveSelection(chosen, () => {
      void rail.refresh().then(() => {
        const survivors = new Set(nodeIds());
        const next = afterElseBefore(before, before[last]!, id => survivors.has(id));
        setSelected(next ? [next] : []);
        rail.select(next ?? null);

        if (next) focusRow(next);
        else container()?.focus();
      });
    });
  };

  const openSelectionMenu = (node: RailNode, x: number, y: number, extra: MenuEntry[] = []) => {
    if (!isSelected(node.id)) setSelected([node.id]);

    focusRow(node.id);
    const chosen = selectedNodes();

    if (chosen.length < 2) return menu.open(node, rail.exitOf(node), x, y, undefined, extra);

    return contextMenu(app, [
      { id: "group", label: copy.group, run: async () => {
        const ids = chosen.map(each => each.id);
        // U5991a: the Rows show grouped now; the refreshed tree or a failure lifts the drawing.
        const outcome = await railCommand(rail, { item: node.id, draw: () => rail.drawGroup(ids, copy.newWorkstreamTitle), call: () => app.rpc("rail.group", { ids }) });

        if (outcome.kind !== "applied") return;
        const group = outcome.value;

        if (rail.collapsed().has(group.id)) rail.toggleCollapsed(group.id);
        rail.select(group.id);
        setSelected([group.id]);
        setEditingName(group.id);
      } },
      { id: "remove-selection", label: copy.removeAll, shortcut: "⇧⌘⌫", run: () => removeSelection(chosen) },
    ], x, y);
  };

  /** U31: exactly one row is reachable by Tab, the selected row when one exists, else the first; moving focus by key does not move it. */
  const tabbableId = createMemo(() => {
    const selected = rail.selected();
    const ids = nodeIds();

    return ids.find((id) => id === selected) ?? ids[0] ?? null;
  });

  /** U358, U6171a: `⇧⌘⌫` anywhere in the window takes the row menu's `remove` for the selected row; the selection then moves to the next row, else the previous, and focus stays in the Rail. A repeat acts on nothing. */
  const removeSelected = (repeat: boolean) => {
    if (!repeat && selectedNodes().length > 1) {
      removeSelection();

      return;
    }

    const id = selectedNodes()[0]?.id ?? rail.selected();
    const node = rail.nodes.find((candidate) => candidate.id === id);
    const row = id === null ? undefined : rowElement(id);

    if (repeat || !node || !row) return;

    const ids = nodeIds();
    const next = afterElseBefore(ids, node.id, each => each !== node.id);
    menu.requestRemove(node, rail.exitOf(node), () => untrack(() => {
      if (next === undefined || rail.selected() !== node.id && !isSelected(node.id)) return;

      setSelected([next]);
      rail.select(next);
      focusRow(next);
    }));
  };

  const openMenuAtFocusedRow = (press: KeyboardEvent) => {
    const id = focusedRowId(press);
    const row = id === undefined ? undefined : rowElement(id);
    const node = rail.nodes.find((candidate) => candidate.id === id);

    if (row && node) {
      const box = row.getBoundingClientRect();
      // U3289c: the keyboard reaches the recovery item through the focused row's menu, since the Rail itself is not a Tab stop.
      void openSelectionMenu(node, box.left, box.bottom, recoveryEntries("key"));
    }
  };

  const { railStep, pointerOutside, placeDrop } = createRailDrag(rail, container, openRow, focusRow);


  /** The index among all of `parent`'s other children for one counted among the shown ones: an Agent in the idle branch is still a sibling. */
  const trueIndex = (id: string, parent: string | null, shown: number): number => {
    if (shown === 0) return 0;

    const anchor = treeRows().filter((row) => row.parent === parent && row.id !== id)[shown - 1];

    return anchor === undefined ? shown : siblingsOf(topology(), parent).filter((node) => node.id !== id).findIndex((node) => node.id === anchor.id) + 1;
  };

  const moveTo = ({ id, parent, index }: SortableMove) => {
    if (daemonExit() !== null || pointerOutside()) return;

    return moveAgent.move({ id, parent, index: trueIndex(id, parent, index) });
  };

  const parent = (): string | null => {
    const selected = rail.nodes.find((node) => node.id === rail.selected());

    return selected?.kind === "workstream" ? selected.id : null;
  };

  const launch = createLaunch(rail);

  /** U6000a, U6000d: the row shows `starting` at once; launches fired while one is pending reach the Daemon in the order fired. Resolves with the new Agent's id. */
  const spawn = (prompt: string | null) => ({
    draw: () => rail.drawNew("agent", copy.newAgent, null),
    call: async () => (await launch(size => app.rpc("agent.spawn", { cwd: project.path, prompt, parent: null, model: null, effort: null, ...size }))).id,
  });

  const spawnAgent = () => {
    if (!canSpawn()) return;
    const focus = captureFocus(true);

    void railCommand(rail, { ...spawn(null), label: copy.newAgent, retry: spawnAgent }).then(outcome => {
      if (outcome.kind === "applied") setWanted({ id: outcome.value, focus });
    });
  };

  const createWorkstream = () => void rail.createWorkstream();

  /** U427, U428: a Workstream's folder is its Door's, an Agent's is its Worktree's, else the Project's. */
  const directoryOf = (node: RailNode) => node.worktree?.path ?? project.path;

  const opened = async (open: () => Promise<void>) => {
    const failed = await failureOf(open);

    if (failed !== null) failure.show(failed);
  };

  const rowIcons = (node: RailNode): Pick<RowActions, "folder" | "editor"> => ({
    folder: () => void opened(() => app.openTarget({ kind: "path", path: directoryOf(node), line: null })),
    editor: () => void opened(() => app.openInEditor(directoryOf(node))),
  });

  const agentActions = (node: RailNode, base: Pick<RowActions, "folder" | "editor">) => {
    const exit = rail.exitOf(node);
    const actions: Extract<RowActions, { kind: "agent" }> = { ...base, kind: "agent" };

    if (isMode(node)) actions.restart = {
      pending: menu.restartPending(node.id),
      run: () => { void menu.restartMode(node.id); },
      menu: click => {
        if (!(click.currentTarget instanceof HTMLElement)) return;
        const box = click.currentTarget.getBoundingClientRect();
        void menu.open(node, rail.exitOf(node), box.left, box.bottom);
      },
    };

    if (menu.isRunning(node, exit)) actions.stop = () => menu.requestStop(node, exit);
    else if (menu.isResumable(node, exit)) actions.resume = () => menu.requestResume(node);

    return actions;
  };

  const actionsOf = (node: RailNode): RowActions => {
    const base = rowIcons(node);

    switch (node.kind) {
      case "workstream": return { ...base, kind: "workstream" };
      case "group": return { ...base, kind: "group" };
      case "agent": return agentActions(node, base);
    }
  };

  /** O11: whether a note has been in flight for 500 ms, when U81's `asking the Door…` shows. */
  const [asking, setAsking] = createSignal(false);

  /** The revision whose recovery entry stands open. */
  const [recovering, setRecovering] = createSignal<string | null>(null);

  /** Sends the task revision `sent` as a note to `door`, or as a new Agent's prompt; the composer closes unless newer typing waits. */
  const deliver = async (sent: { revision: string; destination: Destination }, prompt: string | null, door: string | null) => {
    const focus = captureFocus(true);

    const retry = () => {
      const saved = retained.records().find(entry => entry.revision === sent.revision);

      if (!saved || !canSpawn()) return;

      // The open recovery entry shows the exact uncertain revision without sending it twice.
      if (saved.status === "unknown") setRecovering(saved.revision);
      else void submitPrompt(prompt);
    };

    const slow = setTimeout(() => setAsking(true), 500);

    try {
      // Enter is the owner's own send, so a recovered task goes too.
      compose().save();

      const outcome = await compose().send<string | null>(() => door === null
        ? railCommand(rail, { ...spawn(prompt), label: copy.newAgent, retry })
        : railCommand(rail, { call: () => app.rpc("message.send", { to: door, kind: "note", body: prompt ?? "", replyTo: null }).then(() => null), label: copy.newAgent, retry }));

      const latest = task();

      if (outcome.kind !== "applied" || latest?.status === "draft" && sameDestination(latest.destination, sent.destination)) return;

      if (outcome.result !== null) setWanted({ id: outcome.result, focus });
      endCompose();
    } finally {
      clearTimeout(slow);
      setAsking(false);
    }
  };

  const submitPrompt = async (prompt: string | null) => {
    keepDraft(draft());
    const snapshot = task();

    if (!snapshot || snapshot.status === "pending" || snapshot.status === "unknown") return;
    const under = taskParent();

    if (under !== null && !rail.nodes.some((node) => node.id === under && node.kind === "workstream")) {
      failure.show(copy.railDraftUnavailable);

      return;
    }

    await deliver(snapshot, prompt, prompt !== null && taskAction() === "note" ? snapshot.destination.recipient ?? under : null);
  };

  const canSpawn = () => !rail.workstreamCreating() && !rail.doorPending(rail.selected() ?? "") && daemonExit() === null;

  makeEventListener(document, "click", (event: MouseEvent) => {
    const recoversSpawn = failure.message()?.startsWith(`${copy.newAgent}: `);
    const usesRecovery = event.target instanceof Element && event.target.closest(".rail-command-notice, .rail-actions");

    if (!failure.retry() || recoversSpawn && !usesRecovery) {
      failure.clear();
      rail.clearWorkstreamFailure();
    }

    rail.clearStorageFailure();
  }, { capture: true });

  /** U32, U33: `⌘N` adds an Agent or returns to the open field; `⇧⌘N` opens the field. A kept key acts once. U31, U56, U358: the row menu acts on a focused row only; the keys of a control inside a row are its own. */
  registerKeys({ kind: "app" }, [
    { action: CHORDS["rail.move"], when: press => moveAgent.available(keyedRowIdAt(press, rail.selected())), capture: focus => {
      const id = rowIdAt(focus, rail.selected());

      return { available: () => !!id && !!focus?.isConnected && moveAgent.available(id), invoke: () => { if (id) moveAgent.open(id); } };
    } },
    { action: CHORDS["agent.restart-mode"], when: press => rail.nodes.some(node => node.id === keyedRowIdAt(press, rail.selected()) && isMode(node)), capture: focus => {
      const id = rowIdAt(focus, rail.selected());

      return {
        available: () => !!id && !!focus?.isConnected && daemonExit() === null && rail.nodes.some(node => node.id === id && isMode(node)),
        invoke: () => { if (id) void menu.restartMode(id); },
      };
    } },
    { action: CHORDS["agent.new"], match: "key", capture: () => ({ available: () => composing() || canSpawn(), invoke: () => {
      if (composing()) field()?.focus();
      else spawnAgent();
    } }) },
    { action: { ...CHORDS["agent.new-with-prompt"], get what() { return isEmpty() ? copy.newWorkstreamTitle : copy.newAgentWithAPrompt; } }, match: "key", capture: () => ({ available: canSpawn, invoke: args => { if (isEmpty()) createWorkstream(); else openCompose(args?.prompt); } }) },
    { action: CHORDS["workstream.new"], capture: () => ({ available: canSpawn, invoke: createWorkstream }) },
    { action: CHORDS["mode.new"], capture: () => ({ available: canSpawn, invoke: () => setDialog({ kind: "create-mode" }) }) },
    { chords: ["ContextMenu", "Shift+F10"], when: (press) => focusedRowId(press) !== undefined, run: openMenuAtFocusedRow },
    // U6249d: Escape on a focused row dismisses the failure its line shows, as the line's Dismiss does.
    { chords: ["Escape"], when: press => shownFailure(focusedRowId(press)) !== undefined, run: press => rail.dismiss(shownFailure(focusedRowId(press))!) },
    // U3289c: with the Rail itself focused (no row), the same keys open the recovery item the background right-click opens.
    { chords: ["ContextMenu", "Shift+F10"], when: () => document.activeElement === container() && recoveryEntries().length > 0, run: () => {
      const box = container()!.getBoundingClientRect();

      void contextMenu(app, recoveryEntries(), box.left + 8, box.top + 8);
    } },
    { action: CHORDS["rail.remove"], capture: () => ({ available: () => (selectedNodes().length > 0 || rail.nodes.some((node) => node.id === rail.selected())) && daemonExit() === null, invoke: () => removeSelected(false) }) },
  ]);

  const rename = (when?: (press: KeyboardEvent) => boolean) => ({ action: CHORDS["rail.rename"], ...when && { when }, capture: (focus: Element | null) => {
    const id = rowIdAt(focus, rail.selected());

    return { available: () => !!id && !!focus?.isConnected && !focus?.closest("[data-dnd-dragging]") && daemonExit() === null && editingName() === null && rail.nodes.some(node => node.id === id), invoke: () => { if (id) setEditingName(id); } };
  } });

  registerKeys({ kind: "region", element: container }, [rename()]);
  registerKeys({ kind: "app" }, [rename(strandedRow), ...strandedRowKeys({ nodes: () => rail.nodes, ids: nodeIds, selected: rail.selected, collapsed, active: () => daemonExit() === null, toggle: rail.toggleCollapsed, go: next => { setSelected([next]); rail.select(next); focusRow(next); } })]);

  /** Restoring must not scroll before the window has placed focus (U100). */
  createEffect(
    on(rail.selected, (id) => {
      if (id === null || rail.restored()) return;

      queueMicrotask(() => rowElement(id)?.scrollIntoView({ block: "nearest" }));
    }),
  );

  createEffect(() => {
    const request = wanted();

    if (request !== null && rail.nodes.some((node) => node.id === request.id)) {
      request.focus(() => rail.select(request.id));
      setWanted(null);
    }
  });

  return (
    <>
    <MovePicker replacement={rowElement} target={moveAgent.target()} destinations={moveAgent.destinations()} close={moveAgent.close} choose={(id, parent) => { void moveAgent.move({ id, parent, index: siblingsOf(topology(), parent).length }); }} />
    <Show when={isEmpty()}><EmptyRail onNew={() => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘N")?.run()} onWorkstream={() => captureActions(document.activeElement).find(action => action.value === "action:chord:⇧⌘N")?.run()} available={canSpawn()} /></Show>
    <div class="rail-scroll" onContextMenu={(press: MouseEvent) => {
      // U3289c: the Rail background holds the recovery item; a row keeps its own menu.
      if (press.target instanceof Element && press.target.closest(".rail-row")) return;
      openOnRelease(press, (x, y) => {
        const entries = recoveryEntries();

        if (entries.length > 0) void contextMenu(app, entries, x, y);
      });
    }}>
    <TreeView.RootProvider value={tree}
      class="rail-tree" data-history-region="rail" tabindex="-1"
      ref={(element) => {
        setContainer(element);
        const ctrlClick = ctrlClickGuard();
        // Ark's keys walk the collection, so it shows the rows as drawn first.
        makeEventListener(element, "keydown", () => { settleCollection(); ctrlClick.disarm(); }, { capture: true });
        makeEventListener(element, "pointerdown", ctrlClick.press, { capture: true });
        makeEventListener(element, "click", ctrlClick.click, { capture: true });
      }}
    >

      <Show when={composing()}>
        <ReservedLine status={task() && taskParent() !== parent() ? (copy.railDraftTaskTarget(taskParent() === null ? project.name : destinationName(taskParent()!))) : null} />
        <SpawnPromptField
          ref={setField}
          value={draft()}
          selection={task()?.selection ?? null}
          onSelection={(selection) => { if (task()?.status === "draft") keepDraft(draft(), selection); }}
          onInput={keepDraft}
          onSubmit={(prompt) => {
            if (canSpawn()) submitPrompt(prompt);
          }}
          onCancel={() => { setComposing(false); returnFocus(composeOpener); }}
        />
      </Show>
      <Sortable.Root
        class="rail-sortable"
        ids={nodeIds()}
        tree={{
          rows: treeRows(),
          indent: railStep(),
          // U22: a release outside the Rail's box drops nothing, so a nest steps inside it.
          bounds: () => container()?.getBoundingClientRect(),
          inset: (element) => {
            const content = element.querySelector<HTMLElement>(".line");

            return content ? content.getBoundingClientRect().left - element.getBoundingClientRect().left : 0;
          },
          ...dropRules,
          onMove: moveTo,
          onPreview: (next) => placeDrop(next),
          accepts: () => !pointerOutside(),
        }}
      >
      <TreeView.Tree aria-label={copy.rail} aria-disabled={daemonExit() !== null ? true : undefined}>
        <For each={sections}>{section => <Show when={sectionRows().find(each => each.id === section.id)}>
          <TreeView.NodeProvider node={entryOf(`section:${section.id}`).node} indexPath={entryOf(`section:${section.id}`).indexPath}>
          <TreeView.Branch class="rail-section" aria-label={section.label}>
            <SectionHead icon={section.icon} label={section.label} disclosure={{ open: !rail.closedSections().has(section.id), setOpen: open => rail.setSectionOpen(section.id, open) }} />
            <TreeView.BranchContent>
        <For each={sectionRows().find(each => each.id === section.id)?.rows.map(row => row.key) ?? []}>
          {(key) => (
            <Show when={byKey().get(key)}>
              {(row) => {
                const node = createMemo(() => {
                  const current = row();

                  return current.kind === "node" ? current : undefined;
                });

                const fold = createMemo(() => {
                  const current = row();

                  return current.kind === "fold" ? current : undefined;
                });

                return (
                  <>
                    <Show when={node()}>
                      {(view) => {
                        // U3800d: a row reads its own subtree of the topology, so a move redraws only the rows whose subtree it changed.
                        const id = untrack(() => view().node.id);
                        const below = createMemo(() => topology(), topology(), { equals: (a, b) => sameList(descendantsOf(a, id), descendantsOf(b, id)) });

                        return (
                        <TreeView.NodeProvider node={entryOf(view().node.id).node} indexPath={entryOf(view().node.id).indexPath}>
                        <Sortable.Item id={view().node.id} index={indexOf().get(view().node.id) ?? 0} disabled={daemonExit() !== null} fixed={isMode(view().node)}>{(parts) =>
                        <RailRowView
                          row={view()}
                          topology={below()}
                          todoCount={todoCount(view().node.id)}
                          actions={actionsOf(view().node)}
                          doorAction={<Show when={isWorkstream(view().node) && rail.exitOf(view().node) !== null && !connected.queue.entryOf(view().node.id)}><IconButton aria-label={rail.doorFailure(view().node.id) ? copy.retryDoor : copy.startDoor} aria-disabled={rail.launching(view().node.id)} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); failure.clear(); rail.clearWorkstreamFailure(); void rail.startDoor(view().node.id); }}><Icon name="play" /></IconButton></Show>}
                          rootDivider={entryOf(view().node.id).branch && view().key !== sectionRows().find(each => each.id === section.id)?.rows[0]?.key}
                          copyWith={feedback => {
                            const id = view().node.id;
                            copied.set(id, feedback);

                            return () => { if (copied.get(id) === feedback) copied.delete(id); };
                          }}
                          editing={editingName() === view().node.id}
                          selected={isSelected(view().node.id)}
                          multiple={selected().length > 1}
                          tabbable={tabbableId() === view().node.id}
                          branch={entryOf(view().node.id).branch}
                          onToggle={() => rail.toggleCollapsed(view().node.id)}
                          onOpen={id => openRow(id ?? view().node.id)}
                          onFailure={(message) => {
                            const id = view().node.id;
                            failure.show(message, id, "rail", () => setEditingName(id));
                          }}
                          onEditing={(editing) => setEditingName(editing ? view().node.id : null)}
                          onRename={(name) => {
                            const id = view().node.id;

                            return rail.rename(id, name).then(() => failure.acknowledge(id));
                          }}
                          lifted={parts.isDragging()} folded={lifted() === view().node.id}
                          sortRef={parts.ref}
                          handleRef={parts.handleRef}
                          draggable={daemonExit() === null && !isMode(view().node)}
                          onOpenMenu={(x, y) => void openSelectionMenu(view().node, x, y)}
                        />
                        }</Sortable.Item>
                        </TreeView.NodeProvider>
                        );
                      }}
                    </Show>
                    <Show when={fold()}>
                      {(view) => (
                        <TreeView.NodeProvider node={entryOf(view().key).node} indexPath={entryOf(view().key).indexPath}>
                          <TreeView.Branch data-id={view().key} aria-label={`${view().count}${view().group === "internal" ? copy.internalCount : copy.idleCount}`}>
                            <TreeView.BranchControl class="rail-fold row-wash row-wash-inert" style={{ "--indent": `calc(${view().depth} * var(--rail-step) + var(--rail-inset))` }} onClick={() => setUnfolded(open => toggled(open, view().key.slice(5)))}>
                              <Trunks depth={view().depth} trail={[...view().trail, false]} stem={view().open} />
                              <span class="rail-fold-content"><KindGlyph kind={view().status} decorative /><span class="rail-fold-name">{view().count}{view().group === "internal" ? copy.internalCount : copy.idleCount}</span></span>
                              <TreeView.BranchIndicator><Icon name="right" /></TreeView.BranchIndicator>
                            </TreeView.BranchControl>
                          </TreeView.Branch>
                        </TreeView.NodeProvider>
                      )}
                    </Show>
                  </>
                );
              }}
            </Show>
          )}
        </For>
            </TreeView.BranchContent>
          </TreeView.Branch>
          </TreeView.NodeProvider>
        </Show>}</For>
      </TreeView.Tree>
      </Sortable.Root>
    </TreeView.RootProvider>
    </div>

      <RailRecovery recovery={recovery} revisions={revisions} destinationName={destinationName} open={recovering} setOpen={setRecovering} discard={revision => {
        const current = task()?.revision === revision;
        retained.discard(revision);

        if (current && !task()) setTaskDestination(parent());
      }} />
      <RailDialogs dialog={dialog} close={() => setDialog(null)} menu={menu} rowElement={rowElement} />
      <RailConfirm menu={menu} rowElement={rowElement} />
      <RailFooter retained={retained} asking={asking} canSpawn={canSpawn} createWorkstream={createWorkstream} openCreateMode={() => setDialog({ kind: "create-mode" })} />
    </>
  );
};
