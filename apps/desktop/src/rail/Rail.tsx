import { createMove, MovePicker } from "./MovePicker";
import { WorkProgress } from "../orders/WorkProgress";
import { EmptyRail } from "../app/FirstRun";
import { createRowCollection } from "../ui/RowCollection";
import { outcomeOf } from "../app/seam";
import { captureFocus } from "../keys/focus";
import { CopyButton, type createCopyFeedback } from "../ui/CopyButton";
import * as v from "valibot";
import type { ActionValue } from "../keys/chords";
import { attentionCount } from "./attention";
import { copy } from "./copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { ReservedLine } from "../ink/ReservedLine";
import { SectionHead } from "../ink/SectionHead";
import { KindGlyph } from "../ink/KindGlyph";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ink/Icon";
import { KIND_ICON } from "../ink/kindIcon";
import { KeyChip } from "../keys/KeyChip";
import { CHORDS, LEADER, ariaShortcut } from "../keys/chords";
import { captureActions, registerKeys } from "../keys/registry";
import { Sortable, type SortableMove } from "../ui/sortable";
import type { RailSection } from "./persist/storage";
import { TreeView, Trunks } from "../ui/TreeView";
import { railCollection } from "./collection";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { useConnectedProject } from "../state/connectedProject";
import { doorStateOf } from "./doorState";
import { CreateMode } from "./CreateMode";
import { OpeningPrompt } from "./OpeningPrompt";
import { SaveAsMode } from "./SaveAsMode";
import { RailConfirm } from "./menu/RailConfirm";
import { createRailMenu } from "./menu/model";
import { ancestorsOf, isWorkstream, layoutRail, siblingsOf, type NodeRow } from "./layout";
import { RailRowView } from "./RailRow";
import { focusedRowId, ROW } from "./rows";
import { SpawnPromptField } from "./SpawnPromptField";
import type { RailNode } from "@contracts/agent/RailNode";
import type { ExitState } from "../state/rail";
import type { RowActions } from "./rows";
import type { SpawnParams } from "@contracts/agent/SpawnParams";
import { useRecoveryMenu } from "../drawer/DraftRecovery";
import { contextMenu, openOnRelease } from "../ui/contextMenu";
import { draftsOf } from "./persist/storage";
import "./styles.css";

const toggled = <T,>(set: ReadonlySet<T>, member: T): ReadonlySet<T> =>
  new Set(set.has(member) ? [...set].filter((each) => each !== member) : [...set, member]);

export const Rail = () => {
  const connected = useConnectedProject();
  const { app, project, rail, now, daemonExit } = connected;
  const recoveryEntries = useRecoveryMenu();

  const attention = createMemo(() => attentionCount(rail.nodes, rail.dismissed));
  const [scrolled, setScrolled] = createSignal(false);
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

  const moveAgent = createMove(connected, id => rowElement(id));

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
        { id: "add-agent", label: copy.addAgentMenu, enabled: !actions.add.disabled, run: actions.add.run },
        { id: "add-todo", label: copy.todo, enabled: daemonExit() === null, run: () => connected.createIn("todo", node.id) },
        { id: "add-pad", label: copy.pad, enabled: daemonExit() === null, run: () => connected.createIn("pad", node.id) },
        { id: "add-terminal", label: copy.addTerminalMenu, enabled: daemonExit() === null, run: () => connected.createIn("terminal", node.id) },
      ] },
        ...(rail.exitOf(node) !== null && !connected.queue.entryOf(node.id) ? [{ id: "start", label: rail.doorFailure(node.id) ? copy.retryDoor : copy.startDoor, enabled: !rail.doorPending(node.id), run: () => { failure.clear(); rail.clearWorkstreamFailure(); void rail.startDoor(node.id); } }] : [])] : []),
    ];
  }, id => copied.get(id));


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

    return original !== undefined && doorStateOf(original, rail.exitOf(original), rail.doorPending(original.id), rail.doorFailure(original.id) !== null) === null ? "note" : "spawn";
  };

  const openCompose = (prompt?: ActionValue) => {
    captureFocus(true);

    if (!composing()) setTaskDestination(parent());
    setComposing(true);

    if (prompt !== undefined) keepDraft(String(prompt));
  };

  const endCompose = () => setComposing(false);

  const sections: { id: RailSection; label: string; icon: typeof KIND_ICON[keyof typeof KIND_ICON] }[] = [
    { id: "workstreams", label: copy.workstreamsHead, icon: KIND_ICON.workstream },
    { id: "modes", label: copy.modesHead, icon: KIND_ICON.mode },
    { id: "agents", label: copy.agentsHead, icon: KIND_ICON.agent },
  ];

  const sectionNodes = createMemo(() => {
    const roots = new Map(rail.nodes.filter(node => node.parent === null).map(node => [node.id,
      node.kind === "agent" ? "agents" : node.opening_prompt?.trim() ? "modes" : "workstreams"]));

    return sections.map(section => ({ ...section, nodes: rail.nodes.filter(node => roots.get(ancestorsOf(rail.nodes, node.id).at(-1) ?? node.id) === section.id) }));
  });

  const sectionRows = createMemo(() => sectionNodes().filter(section => section.nodes.length > 0).map(section => ({
    ...section,
    rows: rail.closedSections().has(section.id) ? [] : layoutRail(section.nodes, { collapsed: collapsed(), unfolded: unfolded(), now: now() }),
  })));

  const rows = createMemo(() => sectionRows().flatMap(section => section.rows));

  /** U38: mounting follows the first tree answer; fetch failure takes precedence. */
  const isEmpty = () => rail.nodes.length === 0 && rail.failure() === null;

  /** Section branches share Ark's keyboard walk and add one semantic level above their rows. */
  const collection = createMemo(() => {
    const children = sectionNodes().filter(section => section.nodes.length > 0).map(section => ({
      id: `section:${section.id}`, name: section.label,
      children: railCollection(layoutRail(section.nodes, { collapsed: new Set(), unfolded: unfolded(), now: now() })).rootNode.children ?? [],
    }));

    return createTreeCollection({
      nodeToValue: node => node.id, nodeToString: node => node.name,
      isNodeDisabled: node => Boolean(rowElement(node.id)?.closest("[hidden], [inert], [aria-disabled=true]")),
      rootNode: { id: "", name: "", children },
    });
  });

  const expanded = createMemo(() => collection().getBranchValues().filter(id => {
    const section = sections.find(section => `section:${section.id}` === id);

    return section ? !rail.closedSections().has(section.id) : !collapsed().has(id);
  }));

  /** The tree node and index path Ark's providers need for the row `id`. */
  const entryOf = (id: string) => {
    const indexPath = collection().getIndexPath(id);
    const node = indexPath && collection().at(indexPath);

    if (!indexPath || !node) throw new Error(`no node for row ${id}`);

    return { node, indexPath };
  };

  const nodeRows = createMemo(() => rows().filter((row): row is NodeRow => row.kind === "node"));
  const nodeIds = createMemo(() => nodeRows().map((row) => row.node.id));
  const indexOf = createMemo(() => new Map(nodeIds().map((id, at) => [id, at])));
  const treeRows = createMemo(() => nodeRows().map((row) => ({ id: row.node.id, parent: row.node.parent })));
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));

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

  const openRow = (id: string) => {
    const node = rail.nodes.find(each => each.id === id);

    const attention = node?.kind === "workstream" && node.status?.kind !== "needs-you"
      ? rail.nodes.find(each => each.status?.kind === "needs-you" && ancestorsOf(rail.nodes, each.id).includes(id)) : undefined;

    rail.select(attention?.id ?? id);
    queueMicrotask(() => document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")?.focus());
  };

  const focusRow = (id: string) => rowElement(id)?.focus();

  const selection = createRowCollection(() => nodeRows().filter(row => {
    const element = rowElement(row.node.id);

    return element && !element.closest("[hidden], [inert], [aria-disabled=true]");
  }).map(row => ({ value: row.node.id, label: row.node.name })));

  let anchor: string | undefined;
  createEffect(on(rail.selected, id => {
    selection.selection.setSelectedValues(id === null ? [] : [id]);
    anchor = id ?? undefined;
  }));

  const range = (id: string) => selection.selection.setSelectedValues(anchor === undefined || !selection.collection().has(anchor)
    ? [id] : selection.collection().getValueRange(anchor, id));

  const selectClick = (event: MouseEvent) => {
    if (event.ctrlKey) return;
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(".rail-row") : null;
    const id = row?.dataset.id;

    if (id === undefined || event.target instanceof Element && event.target.closest("button,input") || !event.metaKey && !event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();

    if (!selection.collection().has(id)) return;

    if (event.shiftKey) range(id);
    else { selection.selection.toggle(id); anchor = id; }

    row?.focus();
  };

  const selectKey = (event: KeyboardEvent) => {
    const id = focusedRowId(event);

    if (id === undefined || !rail.nodes.some(node => node.id === id) || daemonExit() !== null || event.ctrlKey || event.altKey || event.isComposing) return;

    if (event.metaKey && event.key.toLowerCase() === "a") {
      event.preventDefault(); event.stopPropagation();
      selection.selection.setSelectedValues(selection.collection().getValues());

      return;
    }

    // Ark owns the complete walk, including section headings; selection still contains only data rows.
    if (!event.metaKey && (event.key === "Home" || event.key === "End" || event.key === "ArrowUp" || event.key === "ArrowDown")) return;

    if (event.target instanceof HTMLElement) event.target.dataset.collectionValue = id;
    const match = selection.search(event);

    if (match === null) {
      if (!event.metaKey && event.key.length === 1 && event.key !== " ") {
        event.preventDefault(); event.stopPropagation();
      }

      return;
    }

    event.preventDefault(); event.stopPropagation();
    selection.selection.replace(match); anchor = match; rail.select(match); focusRow(match);
  };


  /** U31: exactly one row is reachable by Tab, the selected row when one exists, else the first; moving focus by key does not move it. */
  const tabbableId = createMemo(() => {
    const selected = rail.selected();
    const ids = nodeIds();

    return ids.find((id) => id === selected) ?? ids[0] ?? null;
  });

  /** U358: `⌘⌫` in the Rail takes the row menu's `remove` for the selected row; the selection then moves to the next row, else the previous, and focus stays in the Rail. A repeat acts on nothing. */
  const removeSelected = (repeat: boolean) => {
    const id = rail.selected();
    const node = rail.nodes.find((candidate) => candidate.id === id);
    const row = id === null ? undefined : rowElement(id);

    if (repeat || !node || !row) return;

    const ids = nodeIds();
    const next = ids[ids.indexOf(node.id) + 1] ?? ids[ids.indexOf(node.id) - 1];
    menu.requestRemove(node, rail.exitOf(node), () => {
      if (next === undefined || rail.selected() !== node.id) return;

      rail.select(next);
      focusRow(next);
    });
  };

  const openMenuAtFocusedRow = (press: KeyboardEvent) => {
    const id = focusedRowId(press);
    const row = id === undefined ? undefined : rowElement(id);
    const node = rail.nodes.find((candidate) => candidate.id === id);

    if (row && node) {
      const box = row.getBoundingClientRect();
      void menu.open(node, rail.exitOf(node), box.left, box.bottom);
    }
  };

  const openOverviewMenu = (press: KeyboardEvent) => {
    const entries = recoveryEntries("key");

    if (entries.length === 0 || !(press.target instanceof HTMLElement)) return;

    const box = press.target.getBoundingClientRect();
    void contextMenu(app, entries, box.left, box.bottom);
  };

  /** One indent step (--rail-step) in pixels: how far sideways the pointer goes to change the drop's depth. */
  const [railStep, setRailStep] = createSignal(1);

  /** Whether the press that began the drag was a pointer's: a keyboard lift has no pointer to leave the Rail. */
  let pointerPressed = false;
  let pointerAt: { x: number; y: number } | null = null;
  /** The row a keyboard lift began on: the library returns focus only to a handle, and the whole row is the Rail's. */
  let liftedRow: string | null = null;

  const pointerOutside = () => {
    const box = container()?.getBoundingClientRect();

    return pointerPressed && pointerAt !== null && box !== undefined &&
      (pointerAt.x < box.left || pointerAt.x >= box.right || pointerAt.y < box.top || pointerAt.y >= box.bottom);
  };

  createEffect(() => {
    const tree = container();

    if (!tree) return;

    if (tree) {
      // --rail-step is a calc(), so a probe resolves it to pixels once.
      const probe = tree.appendChild(document.createElement("span"));
      probe.style.display = "inline-block";
      probe.style.width = "var(--rail-step)";
      const width = probe.getBoundingClientRect().width;
      probe.remove();

      if (width > 0) setRailStep(width);
    }

    const press = (event: PointerEvent) => {
      pointerPressed = true;
      pointerAt = { x: event.clientX, y: event.clientY };
    };

    const follow = (event: PointerEvent) => { pointerAt = { x: event.clientX, y: event.clientY }; };

    const lift = (key: KeyboardEvent) => {
      pointerPressed = false;

      if (key.code === "Space" && key.target instanceof HTMLElement && key.target.matches(ROW)) liftedRow = key.target.closest<HTMLElement>("[data-id]")?.dataset.id ?? null;

      // U31: Enter on a row selects it. The library would lift on Enter too, so Enter stops here and selects, and only Space lifts.
      if (key.key !== "Enter" || key.metaKey || key.ctrlKey || key.altKey || key.shiftKey || !(key.target instanceof HTMLElement) || !key.target.matches(ROW)) return;

      const id = key.target.closest<HTMLElement>("[data-id]")?.dataset.id;

      if (id === undefined || !rail.nodes.some(node => node.id === id)) return;
      key.stopPropagation();
      key.preventDefault();
      openRow(id);
    };

    window.addEventListener("pointerdown", press, { capture: true });
    window.addEventListener("pointermove", follow, { capture: true });
    tree.addEventListener("keydown", lift, { capture: true });
    onCleanup(() => {
      window.removeEventListener("pointerdown", press, { capture: true });
      window.removeEventListener("pointermove", follow, { capture: true });
      tree.removeEventListener("keydown", lift, { capture: true });
    });
  });

  const placeDrop = (next: { depth: number } | null) => {
    if (next !== null) return;
    const back = liftedRow;

    liftedRow = null;

    if (back !== null) {
      const focus = captureFocus();
      requestAnimationFrame(() => focus(() => focusRow(back)));
    }
  };

  /** The index among all of `parent`'s other children for one counted among the shown ones: a done row folded into its `✓ n done` line is still a sibling. */
  const trueIndex = (id: string, parent: string | null, shown: number): number => {
    if (shown === 0) return 0;

    const anchor = treeRows().filter((row) => row.parent === parent && row.id !== id)[shown - 1];

    return anchor === undefined ? shown : siblingsOf(rail.nodes, parent).filter((node) => node.id !== id).findIndex((node) => node.id === anchor.id) + 1;
  };

  const moveTo = ({ id, parent, index }: SortableMove) => {
    if (daemonExit() !== null || pointerOutside()) return;

    void moveAgent.move({ id, parent, index: trueIndex(id, parent, index) });
  };

  const [pending, setPending] = createSignal(false);

  /** Runs one of the add actions; a second click while the Daemon is still answering would add a second row. */
  const guarded = <T,>(call: () => Promise<T>): void => {
    setPending(true);
    void attempt(call).finally(() => setPending(false));
  };

  const parent = (): string | null => {
    const selected = rail.nodes.find((node) => node.id === rail.selected());

    return selected?.kind === "workstream" ? selected.id : null;
  };

  const spawnAgentWith = (prompt: string | null, under: string | null = parent()) => {
    const params: SpawnParams = { cwd: project.path, prompt, parent: under, model: null, effort: null };

    const run = () => {
      if (!canSpawn()) return;

      if (under !== null && !rail.nodes.some(node => node.id === under && node.kind === "workstream")) {
        failure.show(copy.railDraftUnavailable);

        return;
      }

      guarded(async () => {
        const focus = captureFocus(true);
        let prepared: Awaited<ReturnType<NonNullable<typeof rail.prepareTerminal>>> | undefined;

        try {
          prepared = await rail.prepareTerminal?.();
          const spawned = await app.rpc("agent.spawn", { ...params, ...prepared?.size });

          if (spawned.terminal_id) prepared?.bind(spawned.terminal_id);
          await rail.refresh();
          failure.acknowledge(null);
          setWanted({ id: spawned.id, focus });
        } catch (error) {
          if (!(error instanceof Error)) throw error;

          if (error.name === "AbortError") return;
          failure.show(`${copy.newAgent}: ${error.message}`, null, "rail", run);
        } finally { prepared?.dispose(); }
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
        add: {
          disabled: !canSpawn(),
          shortcut: parent() === node.id && !composing(),
          run: () => {
            if (!canSpawn()) return;

            if (composing()) field()?.focus();
            else spawnAgentWith(null, node.id);
          },
        },
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
  const dismissalLine = () => !(failure.surface() === "rail" && failure.message()) && !rail.storageFailure() && rail.unsavedDismissal() !== null;

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
            const node = await app.rpc("agent.spawn", { cwd: project.path, prompt, parent: originalParent, model: null, effort: null, ...prepared?.size });

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

  const canSpawn = () => !pending() && !rail.workstreamCreating() && !rail.doorPending(rail.selected() ?? "") && daemonExit() === null;

  onMount(() => {
    const clear = (event: MouseEvent) => {
      const recoversSpawn = failure.message()?.startsWith(`${copy.newAgent}: `);
      const usesRecovery = event.target instanceof Element && event.target.closest(".rail-command-notice");

      if (!failure.retry() || recoversSpawn && !usesRecovery) {
        failure.clear();
        rail.clearWorkstreamFailure();
      }

      rail.clearStorageFailure();
    };

    document.addEventListener("click", clear, true);
    onCleanup(() => document.removeEventListener("click", clear, true));
  });

  // U4453b: leader `A` and the Overview row both return to Ask.
  const isAskReturnAllowed = () => !(connected.settingsView.open() && connected.settingsView.page() === "import-work" && connected.importing.pending());

  const backToAsk = () => {
    if (!isAskReturnAllowed()) return;
    connected.importing.cancel();
    connected.settingsView.close(false);
    connected.showView(null);
    rail.select(null);
  };

  createEffect(() => {
    if (rail.selected() === null && !connected.settingsView.open()) return;

    registerKeys({ kind: "leader" }, [{ action: LEADER.find(row => row.keys === "A")!, capture: () => ({
      available: isAskReturnAllowed,
      invoke: backToAsk,
    }) }]);
  });

  /** U32, U33: `⌘N` adds an Agent or returns to the open field; `⇧⌘N` opens the field. A kept key acts once. U31, U56, U358: the row menu and `⌘⌫` act on a focused row only; the keys of a control inside a row are its own. */
  registerKeys({ kind: "app" }, [
    { action: CHORDS.find(row => row.keys === "M" && row.inRail)!, when: press => moveAgent.available(focusedRowId(press)), capture: focus => {
      const id = focus instanceof HTMLElement && focus.matches(ROW) ? focus.closest<HTMLElement>("[data-id]")?.dataset.id : undefined;

      return { available: () => !!id && !!focus?.isConnected && moveAgent.available(id), invoke: () => { if (id) moveAgent.open(id); } };
    } },
    { action: CHORDS.find(row => row.keys === "R" && row.inRail)!, when: press => rail.nodes.some(node => node.id === focusedRowId(press) && node.kind === "workstream" && !!node.opening_prompt?.trim()), capture: focus => {
      const id = focus instanceof HTMLElement && focus.matches(ROW) ? focus.closest<HTMLElement>("[data-id]")?.dataset.id : undefined;

      return {
        available: () => !!id && !!focus?.isConnected && daemonExit() === null && rail.nodes.some(node => node.id === id && node.kind === "workstream" && !!node.opening_prompt?.trim()),
        invoke: () => { if (id) void menu.restartSession(id); },
      };
    } },
    { action: CHORDS.find((row) => row.keys === "⌘N")!, match: "key", capture: () => ({ available: () => composing() || canSpawn(), invoke: () => {
      if (composing()) field()?.focus();
      else spawnAgent();
    } }) },
    { action: { ...CHORDS.find((row) => row.keys === "⇧⌘N")!, get what() { return isEmpty() ? copy.newWorkstreamTitle : copy.newAgentWithAPrompt; } }, match: "key", capture: () => ({ available: canSpawn, invoke: args => { if (isEmpty()) guarded(() => rail.createWorkstream()); else openCompose(args?.prompt); } }) },
    { action: CHORDS.find(row => row.keys === "⌥⌘N")!, capture: () => ({ available: canSpawn, invoke: createWorkstream }) },
    { action: CHORDS.find(row => row.keys === "⇧⌘M")!, capture: () => ({ available: canSpawn, invoke: () => setCreatingMode(true) }) },
    { chords: ["ContextMenu", "Shift+F10"], when: (press) => focusedRowId(press) !== undefined, run: openMenuAtFocusedRow },
    { chords: ["ContextMenu", "Shift+F10"], when: (press) => press.target instanceof HTMLElement && press.target.matches("[data-todo-root]"), run: openOverviewMenu },
    { action: CHORDS.find((row) => row.keys === "⌘⌫")!, when: (press) => focusedRowId(press) !== undefined, capture: (focus) => ({ available: () => focus instanceof HTMLElement && focus.isConnected && focus.matches(ROW) && rail.nodes.some((node) => node.id === rail.selected()) && daemonExit() === null, invoke: () => removeSelected(false) }) },
  ]);

  registerKeys({ kind: "region", element: container }, [{ action: CHORDS.find(row => row.keys === "F2")!, capture: focus => {
    const id = focus instanceof HTMLElement && focus.matches(ROW) ? focus.closest<HTMLElement>("[data-id]")?.dataset.id : undefined;

    return {
      available: () => !!id && !!focus?.isConnected && !focus.classList.contains("sortable-source") && daemonExit() === null && editingName() === null && rail.nodes.some(node => node.id === id),
      invoke: () => { if (id) setEditingName(id); },
    };
  } }]);

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
    <MovePicker target={moveAgent.target()} destinations={moveAgent.destinations()} close={moveAgent.close} choose={(id, parent) => { void moveAgent.move({ id, parent, index: siblingsOf(rail.nodes, parent).length }); }} />
    <button
      type="button"
      data-button="quiet"
      data-todo-root
      data-history-region="rail"
      aria-pressed={rail.selected() === null}
      aria-label={copy.overviewLabel(rail.selected() === null ? 0 : attention())}
      data-scrolled={scrolled()}
      class="todo-project-root"
      onClick={backToAsk}
      onContextMenu={(press: MouseEvent) => openOnRelease(press, (x, y) => {
        const entries = recoveryEntries();

        if (entries.length > 0) void contextMenu(app, entries, x, y);
      })}
    >
      <span class="overview-tile"><Icon name="layout-dashboard" /></span>
      <span>{copy.overview}</span>
      <Show when={attention() > 0 && rail.selected() !== null && connected.drawer.content() === null}>
        <span class="ink-count" data-state="" data-tone="amber" aria-hidden="true">
          <KindGlyph kind="needs-you" decorative /> {attention()}
        </span>
      </Show>
    </button>
    <Show when={isEmpty()}><EmptyRail onNew={() => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘N")?.run()} onWorkstream={() => captureActions(document.activeElement).find(action => action.value === "action:chord:⇧⌘N")?.run()} available={canSpawn()} /></Show>
    <div class="rail-scroll" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
    <TreeView.Root
      class="rail-tree" data-history-region="rail"
      ref={(element) => {
        setContainer(element);
        element.addEventListener("click", selectClick, true);
        element.addEventListener("keydown", selectKey, true);
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
      expandedValue={expanded()}
      selectedValue={selection.selection.selectedValues()}
      expandOnClick={false}
      onSelectionChange={(details) => {
        const id = details.selectedValue.at(-1);

        if (id !== undefined && rail.nodes.some(node => node.id === id)) { selection.selection.replace(id); anchor = id; rail.select(id); queueMicrotask(() => rowElement(id)?.focus()); }
      }}
      onExpandedChange={(details) => {
        const open = new Set(details.expandedValue);

        for (const id of collection().getBranchValues()) {
          const section = sections.find(section => `section:${section.id}` === id);

          if (section) rail.setSectionOpen(section.id, open.has(id));
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
          onCancel={() => setComposing(false)}
        />
      </Show>
      <Sortable.Root
        class="rail-sortable"
        ids={nodeIds()}
        tree={{
          rows: treeRows(),
          indent: railStep(),
          inset: (element) => {
            const content = element.querySelector<HTMLElement>(".line");

            return content ? content.getBoundingClientRect().left - element.getBoundingClientRect().left : 0;
          },
          nests: (id) => rows().some((row) => row.kind === "node" && row.node.id === id && isWorkstream(row.node) && row.collapsed === null),
          onMove: moveTo,
          onPreview: (next) => placeDrop(next),
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
                      {(view) => (
                        <TreeView.NodeProvider node={entryOf(view().node.id).node} indexPath={entryOf(view().node.id).indexPath}>
                        <Sortable.Item id={view().node.id} index={indexOf().get(view().node.id) ?? 0} disabled={daemonExit() !== null}>{(parts) =>
                        <RailRowView
                          row={view()}
                          actions={actionsOf(view().node)}
                          doorAction={<Show when={isWorkstream(view().node) && !view().node.opening_prompt?.trim() && rail.exitOf(view().node) !== null && !connected.queue.entryOf(view().node.id)}><IconButton aria-label={rail.doorFailure(view().node.id) ? copy.retryDoor : copy.startDoor} aria-disabled={rail.doorPending(view().node.id)} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); failure.clear(); rail.clearWorkstreamFailure(); void rail.startDoor(view().node.id); }}><Icon name="play" /></IconButton></Show>}
                          rootDivider={collection().isBranchNode(entryOf(view().node.id).node) && view().key !== sectionRows().find(each => each.id === section.id)?.rows[0]?.key}
                          copyWith={feedback => {
                            const id = view().node.id;
                            copied.set(id, feedback);

                            return () => { if (copied.get(id) === feedback) copied.delete(id); };
                          }}
                          editing={editingName() === view().node.id}
                          selected={selection.selection.isSelected(view().node.id)}
                          multiple={selection.selection.selectedValues().length > 1}
                          tabbable={tabbableId() === view().node.id}
                          branch={collection().isBranchNode(entryOf(view().node.id).node)}
                          onToggle={() => rail.toggleCollapsed(view().node.id)}
                          onFailure={(message) => {
                            const id = view().node.id;
                            failure.show(message, id, "rail", () => setEditingName(id));
                          }}
                          onEditing={(editing) => setEditingName(editing ? view().node.id : null)}
                          onRename={async (name) => {
                            await rail.rename(view().node.id, name);
                            failure.acknowledge(view().node.id);
                          }}
                          lifted={parts.isDragging()}
                          sortRef={parts.ref}
                          handleRef={parts.handleRef}
                          draggable={daemonExit() === null}
                          onOpenMenu={(x, y) => void menu.open(view().node, rail.exitOf(view().node), x, y)}
                        />
                        }</Sortable.Item>
                        </TreeView.NodeProvider>
                      )}
                    </Show>
                    <Show when={fold()}>
                      {(view) => (
                        <div class="rail-fold row-wash" role="none" style={{ "--indent": `calc(${view().depth} * var(--rail-step) + var(--rail-inset))` }}>
                          <Trunks depth={view().depth} trail={[...view().trail, false]} stem={false} />
                          <button data-button="quiet"
                            class="word"
                            role="treeitem"
                            aria-level={view().depth + 2}
                            onClick={() => setUnfolded((open) => toggled(open, view().parent))}
                          >
                            <KindGlyph kind="done" decorative /><span class="rail-fold-name">{view().count}{copy.doneCount}</span></button>
                        </div>
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

      <Show when={recovery().length > 0}>
        <details class="rail-recovery">
          <summary><Icon name="right" />{copy.railDrafts}</summary>
          <For each={recovery().map((entry) => entry.revision).reverse()}>{(revision) => (
            <Show when={revisions().get(revision)}>{(entry) => {
              const text = () => {
                const value = entry().value.text;

                return v.is(v.string(), value) ? value : "";
              };

              const base = () => {
                const value = entry().value.base;

                return v.is(v.string(), value) ? value : null;
              };

              return (
                <details class="rail-recovery-detail" data-revision={entry().revision}>
                  <summary><Icon name="right" /><span>{copy.railDraftRecovery(entry().destination.surface, destinationName(entry().destination.object), entry().status)}</span></summary>
                  <ReservedLine status={entry().destination.object !== "" && entry().destination.object !== project.path && !rail.nodes.some((node) => node.id === entry().destination.object) ? copy.railDraftUnavailable : null} />
                  <textarea aria-label={copy.railDraftRecovered} readOnly value={text()} />
                  <p>{copy.railDraftDestination(project.name, destinationName(entry().destination.recipient ?? entry().destination.object))}</p>
                  <Show when={entry().destination.surface === "rail-task"}><p>{copy.railDraftTaskAction(entry().value.action === "note" || (entry().value.action === undefined && entry().destination.recipient !== null))}</p></Show>
                  <ReservedLine status={entry().destination.surface === "rail-name" && rail.nodes.some((node) => node.id === entry().destination.object && node.name !== entry().value.base) ? copy.railDraftConflict : null} />
                  <Show when={base()}>{(base) => <p>{copy.railDraftBase(base())}</p>}</Show>
                  <div class="rail-recovery-actions">
                  <CopyButton app={connected.app} identity={entry().revision} text={text()} onFailure={error => failure.show(error.message)}>{copy.railDraftCopy}</CopyButton>
                  <button data-button="quiet" onClick={() => {
                    const current = task()?.revision === entry().revision;
                    retained.discard(entry().revision);

                    if (current && !task()) setTaskDestination(parent());
                  }}>{copy.railDraftDiscard}</button>
                  </div>
                </details>
              );
            }}</Show>
          )}</For>
        </details>
      </Show>
      <Show when={savingMode()} keyed>{id => <SaveAsMode id={id} onClose={() => setSavingMode(null)} finalFocus={() => rowElement(id) ?? null} />}</Show>
      <Show when={openingPrompt()} keyed>{id => <OpeningPrompt restart={() => menu.restartSession(id)} id={id} onClose={() => setOpeningPrompt(null)} finalFocus={() => rowElement(id) ?? null} />}</Show>
      <Show when={creatingMode()}><CreateMode finalFocus={id => rowElement(id) ?? null} onClose={() => setCreatingMode(false)} onCreated={(id, request) => {
        setCreatingMode(false);
        // The arriving Door must not reuse the selection permission to take focus from this row.
        const focus = rail.terminalFocus();
        queueMicrotask(() => focus(() => rowElement(id)?.focus({ preventScroll: true })));
        void menu.restartSession(id, request);
      }} /></Show>
      <RailConfirm menu={menu} rowElement={rowElement} />
      <div class="rail-footer">
        <ReservedLine content={failure.message()?.startsWith(`${copy.newAgent}: `) ? <span>{failure.message()!.slice(0, copy.newAgent.length + 2)}<span>{failure.message()!.slice(copy.newAgent.length + 2)}</span></span> : undefined} class="rail-command-notice" overlay={!failure.retry() && !dismissalLine()} message={(failure.surface() === "rail" ? failure.message() : null) ?? rail.storageFailure() ?? (rail.unsavedDismissal() !== null ? copy.dismissalUnsaved(rail.unsavedDismissal()!) : null) ?? (retained.problem()?.destination?.surface.startsWith("rail-") ? copy.railDraftRetention(project.name, retained.problem()!.destination?.surface ?? "rail", retained.problem()!.operation) : null)}
          status={asking() ? copy.askingTheDoor : retained.records().some(entry => entry.destination.surface.startsWith("rail-") && entry.status === "unknown") ? copy.railDraftUnknown(project.name) : null}>
          <Show when={failure.retry()}>{retry => <>
            <button type="button" data-button="quiet" onClick={() => retry()()}>{copy.retry}</button>
            <button type="button" data-button="quiet" onClick={failure.clear}>{copy.dismiss}</button>
          </>}</Show>
          <Show when={dismissalLine()}><button type="button" data-button="quiet" onClick={() => rail.retryDismissal()}>{copy.retry}</button><button type="button" data-button="quiet" onClick={() => rail.clearUnsavedDismissal()}>{copy.dismiss}</button></Show>
          <Show when={retained.problem()?.destination?.surface.startsWith("rail-")}><button data-button="quiet" onClick={() => retained.retry()}>{copy.railDraftRetry}</button></Show>
        </ReservedLine>
        <div class="rail-actions">
          <button type="button" data-button="add" class="word" aria-label={copy.addWorkstream} aria-keyshortcuts={ariaShortcut("⌥⌘N")} aria-disabled={canSpawn() ? undefined : true} onClick={() => { if (canSpawn()) createWorkstream(); }}><Icon name={KIND_ICON.workstream} />{copy.addWorkstreamWord}<KeyChip keys="⌥⌘N" /></button>
          <button type="button" data-button="add" class="word" aria-label={copy.newMode} aria-keyshortcuts={ariaShortcut("⇧⌘M")} aria-disabled={canSpawn() ? undefined : true} onClick={() => { if (canSpawn()) setCreatingMode(true); }}><Icon name={KIND_ICON.mode} />{copy.modeWord}<KeyChip keys="⇧⌘M" /></button>
          <button type="button" data-button="add" class="word" aria-label={copy.newAgent} aria-keyshortcuts={ariaShortcut("⌘N")} aria-disabled={canSpawn() ? undefined : true} onClick={() => captureActions(document.activeElement).find(action => action.value === "action:chord:⌘N")?.run()}><Icon name={KIND_ICON.agent} />{copy.addAgentWord}<KeyChip keys="⌘N" /></button>
        </div>
      </div>
    </>
  );
};
