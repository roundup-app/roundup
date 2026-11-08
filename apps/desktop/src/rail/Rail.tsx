import { useTodoList } from "../todos/todoList";
import { usePadList } from "./pads/padList";
import { createAgentPads } from "./pads/AgentPads";
import { createMove, MovePicker } from "./MovePicker";
import { WorkProgress } from "../orders/WorkProgress";
import { EmptyRail } from "../app/FirstRun";
import { outcomeOf } from "../app/seam";
import { captureFocus, returnFocus } from "../keys/focus";
import { type createCopyFeedback } from "../ui/CopyButton";
import * as v from "valibot";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, lazy, on, onCleanup, onMount, Show, untrack } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { SectionHead } from "../ink/SectionHead";
import { KindGlyph } from "../ink/KindGlyph";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ink/Icon";
import { CHORDS, type ActionValue } from "../keys/chords";
import { captureActions, modalOpen, registerKeys } from "../keys/registry";
import { Sortable, type SortableMove } from "../ui/sortable";
import { TreeView, Trunks } from "../ui/TreeView";
import { useConnectedProject } from "../state/connectedProject";
import { doorStateOf } from "./doorState";
import { OpeningPrompt } from "./OpeningPrompt";
import { SaveAsMode } from "./SaveAsMode";
import { RailConfirm } from "./menu/RailConfirm";
import { createRailMenu } from "./menu/model";
import { ancestorsOf, descendantsOf, isWorkstream, siblingsOf } from "./layout";
import { RailRowView } from "./RailRow";
import { focusedRowId, ROW, type RowActions } from "./rows";
import { strandedFocus } from "../keys/stranded";
import { SpawnPromptField } from "./SpawnPromptField";
import type { RailNode } from "@contracts/agent/RailNode";
import type { ExitState } from "../state/rail";
import type { SpawnParams } from "@contracts/agent/SpawnParams";
import { contextMenu, openOnRelease, type MenuEntry } from "../ui/contextMenu";
import { useRecoveryMenu } from "../drawer/DraftRecovery";
import { draftsOf } from "./persist/storage";
import { createRailDrag } from "./drag";
import { createRailSelection } from "./selection";
import { createRailTree, sameList, sections } from "./railTree";
import { RailRecovery } from "./RailRecovery";
import { RailFooter } from "./RailFooter";
import "./styles.css";

const CreateMode = lazy(() => import("./CreateMode").then(module => ({ default: module.CreateMode })));

const toggled = <T,>(set: ReadonlySet<T>, member: T): ReadonlySet<T> =>
  new Set(set.has(member) ? [...set].filter((each) => each !== member) : [...set, member]);

/** U6829b: a row key acts on the focused row, or on the clicked (selected) row while a click has left focus on the page body. */
const rowIdAt = (focus: Element | null, selected: string | null | undefined): string | undefined => focus instanceof HTMLElement && focus.matches(ROW) ? focus.closest<HTMLElement>("[data-id]")?.dataset.id
  : focus === document.body && !modalOpen() ? selected ?? undefined : undefined;

const keyedRowIdAt = (press: KeyboardEvent, selected: string | null | undefined): string | undefined => focusedRowId(press) ?? (strandedFocus(press) && !press.repeat ? rowIdAt(document.body, selected) : undefined);

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

  const [creatingMode, setCreatingMode] = createSignal(false);
  const [openingPrompt, setOpeningPrompt] = createSignal<string | null>(null);
  const [savingMode, setSavingMode] = createSignal<string | null>(null);
  const copied = new Map<string, ReturnType<typeof createCopyFeedback>>();

  const shownFailure = (id: string | undefined) => rail.nodes.find(node => node.id === id && node.kind === "agent" && node.status?.kind === "error" && !rail.dismissed(node));

  const moveAgent = createMove(connected, id => rowElement(id));

  const knownTodos = useTodoList();
  const knownPads = usePadList();

  const menu = createRailMenu(app, rail, failure.show, failure.acknowledge, connected.drafts, (id) => {
    setEditingName(id);
  }, connected.queue, node => {
    const actions = actionsOf(node);

    return [
      ...(node.kind === "agent" && node.status?.kind === "error" && !rail.dismissed(node) ? [{ id: "dismiss", label: copy.dismissError, run: () => { rail.dismiss(node); } }] : []),
      ...(moveAgent.available(node.id) ? [{ id: "move", label: copy.moveTo, shortcut: "M", run: () => moveAgent.open(node.id) }] : []),
      ...(node.can_make_workstream ? [{ id: "make-workstream", label: copy.makeWorkstream, run: () => { void menu.makeWorkstream(node); } }] : []),
      ...(node.can_save_as_mode ? [{ id: "save-as-mode", label: copy.saveAsMode, run: () => { setSavingMode(node.id); } }] : []),
      ...(node.kind === "workstream" && node.opening_prompt?.trim() ? [{ id: "restart", label: copy.restart, shortcut: "R", run: () => { void menu.restartSession(node.id); } }] : []),
      ...(node.kind === "agent" && node.status !== null || node.kind === "workstream" && node.attempt !== null ? [{
        id: "progress", label: copy.workProgress, run: () => {
          rowElement(node.id)?.focus({ preventScroll: true });
          connected.drawer.open(() => <WorkProgress id={node.id} />, "key", { kind: "progress", project: project.path });
        },
      }] : []),
      ...(node.kind === "workstream" ? [{ id: "opening-prompt", label: copy.openingPromptMenu, run: () => { setOpeningPrompt(node.id); } }] : []),
      { id: "folder", label: copy.openFolder, run: actions.folder },
      { id: "editor", label: copy.openInEditor, run: actions.editor },
      ...(actions.kind === "workstream" ? [{ id: "add", label: copy.addMenu, children: [
        { id: "add-todo", label: copy.todo, enabled: daemonExit() === null, run: () => connected.createIn("todo", node.id) },
        { id: "add-pad", label: copy.pad, enabled: daemonExit() === null, run: () => connected.createIn("pad", node.id) },
        { id: "add-terminal", label: copy.addTerminalMenu, enabled: daemonExit() === null, run: () => connected.createIn("terminal", node.id) },
      ] },
        ...(rail.exitOf(node) !== null && !connected.queue.entryOf(node.id) ? [{ id: "start", label: rail.doorFailure(node.id) ? copy.retryDoor : copy.startDoor, enabled: !rail.launching(node.id), run: () => { failure.clear(); rail.clearWorkstreamFailure(); void rail.startDoor(node.id); } }] : [])] : []),
    ];
  }, id => copied.get(id), () => knownTodos.isLoaded() && !knownTodos.failure() && knownPads.loaded() && !knownPads.failure() ? { todos: knownTodos.all(), pads: knownPads.pads() } : null);


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

  const keepDraft = (text: string, selection = task()?.selection ?? null) => {
    const under = taskParent();
    const action = taskAction();

    return retained.edit(
      task()?.destination ?? { surface: "rail-task", object: under ?? project.path, recipient: action === "note" ? under : null },
      { text, parent: under, model: null, effort: null, action }, selection, "ordinary",
    );
  };

  const taskAction = () => {
    const saved = task();

    if (saved) return v.is(v.picklist(["note", "spawn"]), saved.value.action) ? saved.value.action : saved.destination.recipient === null ? "spawn" : "note";

    const original = rail.nodes.find((node) => node.id === taskDestination());

    return original !== undefined && doorStateOf(original, rail.exitOf(original), rail.launching(original.id), rail.doorFailure(original.id) !== null) === null ? "note" : "spawn";
  };

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


  const attempt = async <T,>(call: () => Promise<T>, item?: string): Promise<void> => {
    try {
      await call();

      if (item !== undefined) failure.acknowledge(item);
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      failure.show(error.message, item);
    }
  };

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
    selection.selection.replace(destination);
    anchorAt(destination);
    rail.select(destination);
  };

  const focusRow = (id: string) => rowElement(id)?.focus();

  const { selection, selectClick, selectKey, anchorAt } = createRailSelection(connected, nodeRows, id => rowElement(id), focusRow);



  const selectedNodes = () => nodeRows().flatMap(row => selection.selection.isSelected(row.node.id) ? [row.node] : []);

  const removeSelection = (chosen = selectedNodes()) => {
    const before = nodeIds();
    const last = Math.max(...chosen.map(node => before.indexOf(node.id)));
    void menu.requestRemoveSelection(chosen, () => {
      void rail.refresh().then(() => {
        const survivors = new Set(nodeIds());
        const next = before.slice(last + 1).find(id => survivors.has(id)) ?? before.slice(0, last).findLast(id => survivors.has(id));
        selection.selection.setSelectedValues(next ? [next] : []);
        rail.select(next ?? null);

        if (next) focusRow(next);
        else container()?.focus();
      });
    });
  };

  const openSelectionMenu = (node: RailNode, x: number, y: number, extra: MenuEntry[] = []) => {
    if (!selection.selection.isSelected(node.id)) {
      selection.selection.replace(node.id);
      anchorAt(node.id);
    }

    focusRow(node.id);
    const chosen = selectedNodes();

    if (chosen.length < 2) return menu.open(node, rail.exitOf(node), x, y, undefined, extra);

    return contextMenu(app, [
      { id: "group", label: copy.group, run: () => attempt(async () => {
        // U5991a: the Rows show grouped now; the refreshed tree or a failure lifts the drawing.
        const lift = rail.drawGroup(chosen.map(each => each.id), copy.newWorkstreamTitle);
        let group: Awaited<ReturnType<typeof app.rpc<"rail.group">>>;

        try {
          group = await app.rpc("rail.group", { ids: chosen.map(each => each.id) });
          await rail.refresh();
        } finally { lift(); }


        if (rail.collapsed().has(group.id)) rail.toggleCollapsed(group.id);
        rail.select(group.id);
        selection.selection.replace(group.id);
        setEditingName(group.id);
      }, node.id) },
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
    const next = ids[ids.indexOf(node.id) + 1] ?? ids[ids.indexOf(node.id) - 1];
    menu.requestRemove(node, rail.exitOf(node), () => untrack(() => {
      if (next === undefined || rail.selected() !== node.id && !selection.selection.isSelected(node.id)) return;

      selection.selection.replace(next);
      anchorAt(next);
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

  /** Runs one of the add actions; U6000d: a second one fired while the Daemon is still answering is not refused. */
  const guarded = <T,>(call: () => Promise<T>): void => {
    void attempt(call);
  };

  const parent = (): string | null => {
    const selected = rail.nodes.find((node) => node.id === rail.selected());

    return selected?.kind === "workstream" ? selected.id : null;
  };

  let sendOrder: Promise<void> = Promise.resolve();

  const spawnAgentWith = (prompt: string | null) => {
    const params: SpawnParams = { cwd: project.path, prompt, parent: null, model: null, effort: null };

    const run = () => {
      if (!canSpawn()) return;

      // U6000a, U6000d: the row (drawn below) shows `starting` at once; launches fired while one is pending reach the Daemon in the order fired.
      const turn = sendOrder;
      let sent!: () => void;

      sendOrder = new Promise<void>(resolve => { sent = resolve; });
      void attempt(async () => {
        const focus = captureFocus(true);
        let prepared: Awaited<ReturnType<NonNullable<typeof rail.prepareTerminal>>> | undefined;
        // U5991a: the Row shows now; the refreshed tree or a failure lifts it.
        const lift = rail.drawNew("agent", copy.newAgent, null);

        try {
          await turn;
          prepared = await rail.prepareTerminal?.();
          const call = app.rpc("agent.spawn", { ...params, ...prepared?.size });

          sent();
          const spawned = await call;

          if (spawned.terminal_id) prepared?.bind(spawned.terminal_id);
          await rail.refresh();
          failure.acknowledge(null);
          setWanted({ id: spawned.id, focus });
        } catch (error) {
          if (!(error instanceof Error)) throw error;

          if (error.name === "AbortError") return;
          failure.show(`${copy.newAgent}: ${error.message}`, null, "rail", run);
        } finally { sent(); lift(); prepared?.dispose(); }
      });
    };

    run();
  };

  const spawnAgent = () => spawnAgentWith(null);
  const createWorkstream = () => guarded(() => rail.createWorkstream());

  /** U427, U428: a Workstream's folder is its Door's, an Agent's is its Worktree's, else the Project's. */
  const directoryOf = (node: RailNode) => node.worktree?.path ?? project.path;

  const rowIcons = (node: RailNode): Pick<RowActions, "folder" | "editor"> => ({
    folder: () => void attempt(() => app.openTarget({ kind: "path", path: directoryOf(node), line: null })),
    editor: () => void attempt(() => app.openInEditor(directoryOf(node))),
  });

  const actionsOf = (node: RailNode): RowActions => {
    const base = rowIcons(node);

    if (node.kind === "workstream") {
      const actions: Extract<RowActions, { kind: "workstream" }> = {
        ...base,
        kind: "workstream",
      };

      if (node.opening_prompt?.trim()) actions.restart = {
        pending: menu.restartPending(node.id),
        run: () => { void menu.restartSession(node.id); },
        menu: click => {
          if (!(click.currentTarget instanceof HTMLElement)) return;
          const box = click.currentTarget.getBoundingClientRect();
          void menu.open(node, rail.exitOf(node), box.left, box.bottom);
        },
      };

      return actions;
    }

    if (node.kind === "group") return { ...base, kind: "group" };

    const exit = rail.exitOf(node);
    const actions: Extract<RowActions, { kind: "agent" }> = { ...base, kind: "agent" };

    if (menu.isRunning(node, exit)) actions.stop = () => stopFromIcon(node, exit);
    else if (menu.isResumable(node, exit)) actions.resume = () => menu.requestResume(node);

    return actions;
  };

  const stopFromIcon = (node: RailNode, exit: ExitState | null) => {
    menu.requestStop(node, exit);
  };

  /** O11: whether a note has been in flight for 500 ms, when U81's `asking the Door…` shows. */
  const [asking, setAsking] = createSignal(false);

  const submitPrompt = async (prompt: string | null, snapshot = task() ?? keepDraft(draft())) => {
    if (snapshot.status === "pending" || snapshot.status === "unknown") return;
    const originalParent = v.is(v.nullable(v.string()), snapshot.value.parent) ? snapshot.value.parent : snapshot.destination.object === "" || snapshot.destination.object === project.path ? null : snapshot.destination.object;
    const action = snapshot.value.action === "note" || snapshot.value.action === undefined && snapshot.destination.recipient !== null ? "note" : "spawn";

    if (originalParent !== null && !rail.nodes.some((node) => node.id === originalParent && node.kind === "workstream")) {
      failure.show(copy.railDraftUnavailable);

      return;
    }

    const revision = (await retained.submit(snapshot.revision));

    if (!revision) return;
    const original = rail.nodes.find((node) => node.id === originalParent);
    const door = prompt !== null && action === "note" ? snapshot.destination.recipient ?? original?.id ?? null : null;
    const focus = captureFocus(true);
    const slow = setTimeout(() => setAsking(true), 500);
    guarded(async () => {
      let spawned: string | null = null;

      try {
        if (door !== null) await app.rpc("message.send", { to: door, kind: "note", body: prompt!, replyTo: null });
        else {
          const prepared = await rail.prepareTerminal?.();

          try {
            const node = await app.rpc("agent.spawn", { cwd: project.path, prompt, parent: null, model: null, effort: null, ...prepared?.size });

            if (node.terminal_id) prepared?.bind(node.terminal_id);
            spawned = node.id;
            await rail.refresh();
          } finally { prepared?.dispose(); }
        }

        const latest = task()?.revision === revision.revision;
        retained.settle(revision.revision, "acknowledged");
        failure.acknowledge(null);

        if (latest) {
          if (spawned !== null) setWanted({ id: spawned, focus });
          endCompose();
        }
      } catch (error) {
        const outcome = outcomeOf(error);
        retained.settle(revision.revision, outcome);

        if (!(error instanceof Error)) throw error;

        if (error.name === "AbortError") return;
        failure.show(`${copy.newAgent}: ${error.message}`, null, "rail", () => {
          const saved = retained.records().find(entry => entry.revision === revision.revision);

          if (!saved || !canSpawn()) return;

          if (saved.status === "unknown") {
            // Native details expose the exact uncertain revision without issuing a duplicate.
            const recovered = document.querySelector<HTMLElement>(`[data-revision="${CSS.escape(saved.revision)}"]`);
            recovered?.closest(".rail-recovery")?.setAttribute("open", "");
            recovered?.setAttribute("open", "");
            recovered?.querySelector("textarea")?.focus();
          } else void submitPrompt(prompt, saved);
        });
      } finally {
        clearTimeout(slow);
        setAsking(false);
      }
    });
  };

  const canSpawn = () => !rail.workstreamCreating() && !rail.doorPending(rail.selected() ?? "") && daemonExit() === null;

  onMount(() => {
    const clear = (event: MouseEvent) => {
      const recoversSpawn = failure.message()?.startsWith(`${copy.newAgent}: `);
      const usesRecovery = event.target instanceof Element && event.target.closest(".rail-command-notice, .rail-actions");

      if (!failure.retry() || recoversSpawn && !usesRecovery) {
        failure.clear();
        rail.clearWorkstreamFailure();
      }

      rail.clearStorageFailure();
    };

    document.addEventListener("click", clear, true);
    onCleanup(() => document.removeEventListener("click", clear, true));
  });

  const idAt = (focus: Element | null) => rowIdAt(focus, rail.selected());

  /** U32, U33: `⌘N` adds an Agent or returns to the open field; `⇧⌘N` opens the field. A kept key acts once. U31, U56, U358: the row menu acts on a focused row only; the keys of a control inside a row are its own. */
  registerKeys({ kind: "app" }, [
    { action: CHORDS["rail.move"], when: press => moveAgent.available(keyedRowIdAt(press, rail.selected())), capture: focus => {
      const id = idAt(focus);

      return { available: () => !!id && !!focus?.isConnected && moveAgent.available(id), invoke: () => { if (id) moveAgent.open(id); } };
    } },
    { action: CHORDS["agent.restart-mode"], when: press => rail.nodes.some(node => node.id === keyedRowIdAt(press, rail.selected()) && node.kind === "workstream" && !!node.opening_prompt?.trim()), capture: focus => {
      const id = idAt(focus);

      return {
        available: () => !!id && !!focus?.isConnected && daemonExit() === null && rail.nodes.some(node => node.id === id && node.kind === "workstream" && !!node.opening_prompt?.trim()),
        invoke: () => { if (id) void menu.restartSession(id); },
      };
    } },
    { action: CHORDS["agent.new"], match: "key", capture: () => ({ available: () => composing() || canSpawn(), invoke: () => {
      if (composing()) field()?.focus();
      else spawnAgent();
    } }) },
    { action: { ...CHORDS["agent.new-with-prompt"], get what() { return isEmpty() ? copy.newWorkstreamTitle : copy.newAgentWithAPrompt; } }, match: "key", capture: () => ({ available: canSpawn, invoke: args => { if (isEmpty()) guarded(() => rail.createWorkstream()); else openCompose(args?.prompt); } }) },
    { action: CHORDS["workstream.new"], capture: () => ({ available: canSpawn, invoke: createWorkstream }) },
    { action: CHORDS["mode.new"], capture: () => ({ available: canSpawn, invoke: () => setCreatingMode(true) }) },
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
    const id = idAt(focus);

    return { available: () => !!id && !!focus?.isConnected && !focus?.closest("[data-dnd-dragging]") && daemonExit() === null && editingName() === null && rail.nodes.some(node => node.id === id), invoke: () => { if (id) setEditingName(id); } };
  } });

  registerKeys({ kind: "region", element: container }, [rename()]);
  registerKeys({ kind: "app" }, [rename(press => strandedFocus(press) && !press.repeat)]);

  /** U6829b: the row arrows on the clicked row while a click has left focus on the page body; Ark's tree walks only from a focused row. */
  const strandedArrow = (press: KeyboardEvent) => strandedFocus(press) && !press.repeat && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey && daemonExit() === null;
  registerKeys({ kind: "app" }, [
    { chords: ["ArrowUp", "ArrowDown"], when: press => strandedArrow(press) && keyedRowIdAt(press, rail.selected()) !== undefined, run: press => {
      const ids = nodeIds();
      const next = ids[ids.indexOf(rail.selected()!) + (press.key === "ArrowDown" ? 1 : -1)];

      if (next === undefined) return;

      selection.selection.replace(next); anchorAt(next); rail.select(next); focusRow(next);
    } },
    { chords: ["ArrowLeft", "ArrowRight"], when: press => {
      const id = strandedArrow(press) ? keyedRowIdAt(press, rail.selected()) : undefined;
      const node = rail.nodes.find(candidate => candidate.id === id);

      return node !== undefined && (node.kind === "workstream" || node.kind === "group") && collapsed().has(node.id) === (press.key === "ArrowRight");
    }, run: () => rail.toggleCollapsed(rail.selected()!) },
  ]);

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
    <TreeView.Root
      class="rail-tree" data-history-region="rail" tabindex="-1"
      ref={(element) => {
        setContainer(element);
        element.addEventListener("click", selectClick, true);
        // Ark walks its collection on a key, so the collection shows the rows as drawn first.
        element.addEventListener("keydown", event => { settleCollection(); selectKey(event); }, true);
        let contextClick = false;
        element.addEventListener("pointerdown", (event) => {
          contextClick = event.button === 0 && event.ctrlKey;

          // macOS Ctrl-click must not focus a row, blur unfinished input or arm its sort sensor.
          if (contextClick) {
            event.preventDefault();
            event.stopPropagation();
          }
        }, true);
        // A native menu may consume the compatibility click; keyboard activation must still work next.
        element.addEventListener("keydown", () => { contextClick = false; }, true);
        element.addEventListener("click", (event) => {
          if (!contextClick && !event.ctrlKey) return;

          contextClick = false;
          event.preventDefault();
          event.stopPropagation();
        }, true);
      }}
      collection={collection()}
      focusedValue={focused()}
      onFocusChange={details => setFocused(details.focusedValue)}
      expandedValue={expanded()}
      selectedValue={selection.selection.selectedValues()}
      expandOnClick={false}
      onExpandedChange={(details) => {
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
                        <Sortable.Item id={view().node.id} index={indexOf().get(view().node.id) ?? 0} disabled={daemonExit() !== null}>{(parts) =>
                        <RailRowView
                          row={view()}
                          topology={below()}
                          todoCount={todoCount(view().node.id)}
                          actions={actionsOf(view().node)}
                          doorAction={<Show when={isWorkstream(view().node) && !view().node.opening_prompt?.trim() && rail.exitOf(view().node) !== null && !connected.queue.entryOf(view().node.id)}><IconButton aria-label={rail.doorFailure(view().node.id) ? copy.retryDoor : copy.startDoor} aria-disabled={rail.launching(view().node.id)} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); failure.clear(); rail.clearWorkstreamFailure(); void rail.startDoor(view().node.id); }}><Icon name="play" /></IconButton></Show>}
                          rootDivider={entryOf(view().node.id).branch && view().key !== sectionRows().find(each => each.id === section.id)?.rows[0]?.key}
                          copyWith={feedback => {
                            const id = view().node.id;
                            copied.set(id, feedback);

                            return () => { if (copied.get(id) === feedback) copied.delete(id); };
                          }}
                          editing={editingName() === view().node.id}
                          selected={selection.selection.isSelected(view().node.id)}
                          multiple={selection.selection.selectedValues().length > 1}
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
                          draggable={daemonExit() === null}
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
    </TreeView.Root>
    </div>

      <RailRecovery recovery={recovery} revisions={revisions} destinationName={destinationName} discard={revision => {
        const current = task()?.revision === revision;
        retained.discard(revision);

        if (current && !task()) setTaskDestination(parent());
      }} />
      <Show when={savingMode()} keyed>{id => <SaveAsMode id={id} onClose={() => setSavingMode(null)} finalFocus={() => rowElement(id) ?? null} />}</Show>
      <Show when={openingPrompt()} keyed>{id => <OpeningPrompt restart={() => menu.restartSession(id)} id={id} onClose={() => setOpeningPrompt(null)} finalFocus={() => rowElement(id) ?? null} />}</Show>
      <Show when={creatingMode()}><CreateMode finalFocus={id => rowElement(id) ?? null} onClose={() => setCreatingMode(false)} onCreated={(id, request) => {
        setCreatingMode(false);
        // The arriving Door must not reuse the selection permission to take focus from this row.
        const focus = rail.terminalFocus();
        queueMicrotask(() => untrack(() => focus(() => rowElement(id)?.focus({ preventScroll: true }))));
        void menu.restartSession(id, request);
      }} /></Show>
      <RailConfirm menu={menu} rowElement={rowElement} />
      <RailFooter retained={retained} asking={asking} canSpawn={canSpawn} createWorkstream={createWorkstream} openCreateMode={() => setCreatingMode(true)} />
    </>
  );
};
