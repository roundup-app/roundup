import * as v from "valibot";
import { attentionCount } from "./attention";
import { copy } from "../copy";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { ErrorLine } from "../ink/ErrorLine";
import { SectionHead } from "../ink/SectionHead";
import { KindGlyph } from "../ink/KindGlyph";
import { Icon } from "../ink/Icon";
import { CHORDS } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { Sortable, type SortableMove } from "../ui/sortable";
import { TreeView } from "../ui/TreeView";
import { railCollection } from "./collection";
import { useConnectedProject } from "../state/connectedProject";
import { doorStateOf } from "./doorState";
import { RailMenu } from "./menu/RailMenu";
import { createRailMenu } from "./menu/model";
import { agentKindsBelow, isWorkstream, layoutRail, siblingsOf } from "./layout";
import type { NodeRow } from "./layout";
import { RailRowView } from "./RailRow";
import { focusedRowId, ROW } from "./rows";
import { Trunks } from "./Trunks";
import { SpawnPromptField } from "./SpawnPromptField";
import type { RailNode } from "@contracts/agent/RailNode";
import type { ExitState } from "../state/rail";
import type { RowActions } from "./RowIcons";
import type { SpawnParams } from "@contracts/agent/SpawnParams";
import { ClearPrompt } from "./ClearPrompt";
import { INTERNAL_CODE, RpcError } from "../app/seam";
import { clearingOf, railDraftsFor } from "./clear";
import "./styles.css";

const toggled = <T,>(set: ReadonlySet<T>, member: T): ReadonlySet<T> =>
  new Set(set.has(member) ? [...set].filter((each) => each !== member) : [...set, member]);

export const Rail = () => {
  const connected = useConnectedProject();
  const { app, project, rail, now, daemonExit } = connected;

  const attention = createMemo(() => attentionCount(rail.nodes));
  const [scrolled, setScrolled] = createSignal(false);
  const collapsed = rail.collapsed;
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string | null>>(new Set());
  const [failure, setFailure] = createSignal<string | null>(null);
  const menu = createRailMenu(app, rail, setFailure, connected.events);

  const clearPrompt = createMemo(() => {
    const node = menu.clearTarget();

    return node !== null && clearingOf(app, connected.events, node.id).phase() !== "closed" ? node : null;
  });

  const [wanted, setWanted] = createSignal<string | null>(null);
  /** Gates `⌘N` in the chord handler and the add-agent click below, so an open field is never dropped mid-type (U33). */
  const [composing, setComposing] = createSignal(false);
  /** U2227: the typed task, kept per Project across Esc until it is emptied or a spawn from the field succeeds. */
  const drafts = railDraftsFor(connected.events, project.path);
  const task = () => drafts.list().filter((draft) => draft.destination.surface === "rail-task").at(-1);

  const draft = () => v.parse(v.optional(v.string(), ""), task()?.value.text);

  const keepDraft = (text: string, selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | null = null) => {
    const previous = task();
    drafts.edit(previous?.destination ?? { surface: "rail-task", object: parent() ?? "", recipient: runningDoor() }, { text }, selection, "ordinary");
  };

  const endCompose = (revision?: string) => {
    if (revision && task() && task()?.revision !== revision) return;
    setComposing(false);
  };

  const rows = createMemo(() => layoutRail(rail.nodes, { collapsed: collapsed(), unfolded: unfolded(), now: now() }));

  /** U38: the empty line waits for the first `rail.tree` (always answered before the Rail mounts) and yields to a fetch failure, which the centre shows instead. */

  /** U520: every Workstream open, so Ark can open one that is folded and walk into it; Ark's `expandedValue` keeps the folded ones shut. */
  const collection = createMemo(() => railCollection(layoutRail(rail.nodes, { collapsed: new Set(), unfolded: unfolded(), now: now() })));
  const expanded = createMemo(() => collection().getBranchValues().filter((id) => !collapsed().has(id)));

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
  const keys = createMemo(() => rows().map((row) => row.key));
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));

  const attempt = async <T,>(call: () => Promise<T>): Promise<void> => {
    try {
      await call();
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      setFailure(error.message);
    }
  };

  const [container, setContainer] = createSignal<HTMLElement>();
  const [field, setField] = createSignal<HTMLTextAreaElement>();

  /** The focusable element of the row `id`: its item, or the control of its branch. */
  const rowElement = (id: string) => container()?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.closest<HTMLElement>(ROW) ?? container()?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-part="branch-control"]`) ?? undefined;

  let clearElement: HTMLDivElement | undefined;

  /** U350: the prompt stays within the Rail, so its ground never runs into the centre pane's ground and reads as cut off. */
  const placeClear = () => {
    const node = clearPrompt();
    const row = node ? rowElement(node.id)?.getBoundingClientRect() : undefined;
    const rail = container()?.getBoundingClientRect();

    if (!row || !rail || !clearElement) return;

    const inset = parseFloat(getComputedStyle(clearElement).paddingLeft);

    // The box is content-box: its width leaves out its own padding, which equals the inset kept on each side.
    clearElement.style.maxWidth = `${Math.max(0, rail.width - 4 * inset)}px`;

    const box = clearElement.getBoundingClientRect();
    const top = row.bottom + box.height <= window.innerHeight - inset ? row.bottom : row.top - box.height;

    clearElement.style.left = `${Math.max(rail.left + inset, Math.min(row.left, rail.right - box.width - inset))}px`;
    clearElement.style.top = `${Math.max(inset, Math.min(top, window.innerHeight - box.height - inset))}px`;
  };

  onMount(() => {
    window.addEventListener("resize", placeClear);
    document.addEventListener("scroll", placeClear, true);
    onCleanup(() => {
      window.removeEventListener("resize", placeClear);
      document.removeEventListener("scroll", placeClear, true);
    });
  });

  const focusRow = (id: string) => rowElement(id)?.focus();

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
    const box = row.getBoundingClientRect();

    menu.requestRemove(node, rail.exitOf(node), box.left, box.bottom, () => {
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
      menu.open(node, rail.exitOf(node), box.left, box.bottom);
    }
  };

  /** One indent step (--rail-step) in pixels: how far sideways the pointer goes to change the drop's depth. */
  const [railStep, setRailStep] = createSignal(1);

  const [drop, setDrop] = createSignal<{ depth: number; top: number } | null>(null);

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

  onMount(() => {
    const tree = container();

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

      key.stopPropagation();
      key.preventDefault();

      const id = key.target.closest<HTMLElement>("[data-id]")?.dataset.id;

      if (id !== undefined) rail.select(id);
    };

    window.addEventListener("pointerdown", press, { capture: true });
    window.addEventListener("pointermove", follow, { capture: true });
    container()?.addEventListener("keydown", lift, { capture: true });
    onCleanup(() => {
      window.removeEventListener("pointerdown", press, { capture: true });
      window.removeEventListener("pointermove", follow, { capture: true });
      container()?.removeEventListener("keydown", lift, { capture: true });
    });
  });

  /** Where the drop line sits: at the top of the room the library opened for the dragged row, once it has moved there. */
  const placeDrop = (next: { depth: number } | null) => {
    if (next === null) {
      const back = liftedRow;

      liftedRow = null;
      setDrop(null);

      if (back !== null) requestAnimationFrame(() => focusRow(back));

      return;
    }

    queueMicrotask(() => {
      const base = container()?.getBoundingClientRect();
      const room = container()?.querySelector("[data-dnd-placeholder]")?.getBoundingClientRect();

      setDrop(base && room ? { depth: next.depth, top: room.top - base.top } : null);
    });
  };

  /** The index among all of `parent`'s other children for one counted among the shown ones: a done row folded into its `✓ n done` line is still a sibling. */
  const trueIndex = (id: string, parent: string | null, shown: number): number => {
    if (shown === 0) return 0;

    const anchor = treeRows().filter((row) => row.parent === parent && row.id !== id)[shown - 1];

    return anchor === undefined ? shown : siblingsOf(rail.nodes, parent).filter((node) => node.id !== id).findIndex((node) => node.id === anchor.id) + 1;
  };

  const moveTo = ({ id, parent, index }: SortableMove) => {
    if (daemonExit() !== null || pointerOutside()) return;

    void attempt(() => app.rpc("rail.move", { id, parent, index: trueIndex(id, parent, index) }));
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

  const spawnAgentWith = (prompt: string | null, under: string | null = parent(), revision?: string) =>
    guarded(async () => {
      const params: SpawnParams = { cwd: project.path, prompt, parent: under, model: null, effort: null };

      let spawned;

      try {
        spawned = await app.rpc("agent.spawn", params);

        if (revision) drafts.settle(revision, "acknowledged");
      } catch (error) {
        if (revision) drafts.settle(revision, error instanceof RpcError && error.code !== INTERNAL_CODE ? "failed" : "unknown");
        throw error;
      }

      setWanted(spawned.id);

      if (composing()) endCompose(revision);
    });

  const spawnAgent = () => spawnAgentWith(null);

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
          run: () => {
            if (!canSpawn()) return;

            if (composing()) field()?.focus();
            else spawnAgentWith(null, node.id);
          },
        },
      };

      if (menu.isClearable(node)) actions.clear = () => menu.requestClear(node);

      return actions;
    }

    const exit = rail.exitOf(node);
    const actions: Extract<RowActions, { kind: "agent" }> = { ...base, kind: "agent" };

    if (menu.isRunning(node, exit)) actions.stop = () => stopFromIcon(node, exit);
    else if (menu.isResumable(node, exit)) actions.resume = () => menu.requestResume(node);

    return actions;
  };

  const stopFromIcon = (node: RailNode, exit: ExitState | null) => {
    const box = rowElement(node.id)?.getBoundingClientRect();

    menu.requestStop(node, exit, box?.left ?? 0, box?.bottom ?? 0);
  };

  /** O11: whether a note has been in flight for 500 ms, when U81's `asking the Door…` shows. */
  const [asking, setAsking] = createSignal(false);

  /** O11: the running Door of the selected Workstream, whose Message carries a typed prompt; `null` at the Project root or with no running Door (O13). */
  const runningDoor = (): string | null => {
    const id = parent();
    const door = rail.nodes.find((node) => node.id === id);

    return door !== undefined && doorStateOf(door, rail.exitOf(door), rail.doorPending(door.id), rail.doorFailure(door.id) !== null) === null ? door.id : null;
  };

  const submitPrompt = (prompt: string | null) => {
    const current = task();

    if (current?.status === "pending" || current?.status === "unknown") return;
    const target = current?.destination;

    if (target?.object && !rail.nodes.some((node) => node.id === target.object)) {
      setFailure(copy.railDestinationUnavailable);

      return;
    }

    const revision = current?.revision;

    if (revision) drafts.submit(revision);
    const door = prompt === null ? null : target ? target.recipient : runningDoor();

    if (prompt === null || door === null) return spawnAgentWith(prompt, target ? target.object || null : parent(), revision);
    const slow = setTimeout(() => setAsking(true), 500);
    guarded(async () => {
      try {
        await app.rpc("message.send", { to: door, kind: "note", body: prompt, replyTo: null });

        if (revision) drafts.settle(revision, "acknowledged");
        endCompose(revision);
      } catch (error) {
        if (revision) drafts.settle(revision, error instanceof RpcError && error.code !== INTERNAL_CODE ? "failed" : "unknown");
        throw error;
      } finally {
        clearTimeout(slow);
        setAsking(false);
      }
    });
  };

  const canSpawn = () => !pending() && !rail.workstreamCreating() && !rail.doorPending(rail.selected() ?? "") && daemonExit() === null;

  onMount(() => {
    const clear = () => {
      setFailure(null);
      rail.clearWorkstreamFailure();
      rail.clearStorageFailure();
    };

    document.addEventListener("click", clear, true);
    onCleanup(() => document.removeEventListener("click", clear, true));
  });

  /** U32, U33: `⌘N` adds an Agent or returns to the open field; `⇧⌘N` opens the field. A held key acts once. U31, U56, U358: the row menu and `⌘⌫` act on a focused row only; the keys of a control inside a row are its own. */
  registerKeys({ kind: "app" }, [
    { action: CHORDS.find((row) => row.keys === "⌘N")!, match: "key", capture: () => ({ available: () => composing() || canSpawn(), invoke: () => {
      if (composing()) field()?.focus();
      else spawnAgent();
    } }) },
    { action: CHORDS.find((row) => row.keys === "⇧⌘N")!, match: "key", capture: () => ({ available: canSpawn, invoke: () => setComposing(true) }) },
    { chords: ["ContextMenu", "Shift+F10"], when: (press) => focusedRowId(press) !== undefined, run: openMenuAtFocusedRow },
    { action: CHORDS.find((row) => row.keys === "⌘⌫")!, when: (press) => focusedRowId(press) !== undefined, capture: (focus) => ({ available: () => focus instanceof HTMLElement && focus.isConnected && focus.matches(ROW) && rail.nodes.some((node) => node.id === rail.selected()) && daemonExit() === null, invoke: () => removeSelected(false) }) },
  ]);

  /** Restoring must not scroll before the window has placed focus (U100). */
  createEffect(
    on(rail.selected, (id) => {
      if (id === null || rail.restored()) return;

      queueMicrotask(() => rowElement(id)?.scrollIntoView({ block: "nearest" }));
    }),
  );

  createEffect(() => {
    const id = wanted();

    if (id !== null && rail.nodes.some((node) => node.id === id)) {
      rail.select(id);
      setWanted(null);
    }
  });

  return (
    <>
    <button
      type="button"
      data-button="quiet"
      data-todo-root
      aria-pressed={rail.selected() === null}
      aria-label={copy.overviewLabel(attention())}
      data-scrolled={scrolled()}
      class="todo-project-root"
      onClick={() => rail.select(null)}
    >
      <span class="overview-tile"><Icon name="layout-dashboard" /></span>
      <span>{copy.overview}</span>
      <Show when={attention() > 0}>
        <span class="ink-count" data-state="" data-tone="amber" aria-hidden="true">
          <KindGlyph kind="needs-you" decorative /> {attention()}
        </span>
      </Show>
    </button>
    <div class="rail-scroll" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
    <TreeView.Root
      class="rail-tree"
      ref={setContainer}
      collection={collection()}
      expandedValue={expanded()}
      selectedValue={rail.selected() === null ? [] : [rail.selected()!]}
      expandOnClick={false}
      onSelectionChange={(details) => {
        const id = details.selectedValue.at(-1);

        if (id !== undefined) rail.select(id);
      }}
      onExpandedChange={(details) => {
        const open = new Set(details.expandedValue);

        for (const id of collection().getBranchValues()) if (open.has(id) === collapsed().has(id)) rail.toggleCollapsed(id);
      }}
    >
      <SectionHead icon="messages" label={copy.workstreamsHead} />
      <Show when={composing()}>
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
          nests: (id) => rows().some((row) => row.kind === "node" && row.node.id === id && isWorkstream(row.node) && row.collapsed === null),
          onMove: moveTo,
          onPreview: (next) => placeDrop(next),
        }}
      >
      <TreeView.Tree aria-label={copy.rail} aria-disabled={daemonExit() !== null ? true : undefined}>
        <For each={keys()}>
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
                          exit={rail.exitOf(view().node)}
                          needsYou={isWorkstream(view().node) ? agentKindsBelow(rail.nodes, view().node.id).filter((kind) => kind === "needs-you").length : 0}
                          selected={rail.selected() === view().node.id}
                          tabbable={tabbableId() === view().node.id}
                          branch={collection().isBranchNode(entryOf(view().node.id).node)}
                          onToggle={() => rail.toggleCollapsed(view().node.id)}
                          onStartDoor={() => { rail.select(view().node.id); void rail.startDoor(view().node.id); }}
                          doorPending={rail.doorPending(view().node.id)}
                          doorFailure={rail.doorFailure(view().node.id)}
                          lifted={parts.isDragging()}
                          sortRef={parts.ref}
                          actions={actionsOf(view().node)}
                          onOpenMenu={(press) => menu.open(view().node, rail.exitOf(view().node), press.clientX, press.clientY)}
                        />
                        }</Sortable.Item>
                        </TreeView.NodeProvider>
                      )}
                    </Show>
                    <Show when={fold()}>
                      {(view) => (
                        <div class="rail-fold" role="none" style={{ "--indent": `calc(${view().depth} * var(--rail-step) + var(--rail-inset))` }}>
                          <Trunks depth={view().depth} trail={[...view().trail, false]} stem={false} />
                          <button data-button="quiet"
                            class="word"
                            role="treeitem"
                            aria-level={view().depth + 1}
                            onClick={() => setUnfolded((open) => toggled(open, view().parent))}
                          >
                            <KindGlyph kind="done" decorative /> {view().count}{copy.doneCount}</button>
                        </div>
                      )}
                    </Show>
                  </>
                );
              }}
            </Show>
          )}
        </For>
      </TreeView.Tree>
      <Show when={drop()}>
        {(line) => <div class="drop-line" aria-hidden="true" style={{ top: `${line().top}px`, "--depth": line().depth }} />}
      </Show>
      </Sortable.Root>
    </TreeView.Root>
    </div>
      <Show when={failure() ?? rail.workstreamFailure() ?? rail.doorFailure(rail.selected() ?? "") ?? rail.storageFailure()}>{(message) => <ErrorLine message={message()} />}</Show>
      <div class="rail-recovery">
      <Show when={drafts.problem()}>
        <p role="alert" class="ink" data-tone="red">{copy.railRetentionFailed(project.name)} <button data-button="quiet" onClick={() => drafts.retry()}>{copy.retryRetention}</button></p>
      </Show>
      <For each={drafts.list()}>{(saved) => <Show when={drafts.problem() || saved.destination.surface === "rail-name" || saved.status !== "draft" || (saved.destination.object !== "" && !rail.nodes.some((node) => node.id === saved.destination.object))}>
        <div class="light" data-state={saved.status}>
          <p>{copy.retainedRailSummary(saved.destination.surface === "rail-name" ? copy.name : saved.destination.surface === "rail-clear" ? copy.whyClear : copy.task, saved.destination.object || project.name, saved.status)}</p>
          <textarea class="spawn-prompt-field" aria-label={copy.retainedRailInput} readOnly value={String(saved.value.text ?? "")} />
          <span class="rail-recovery-actions"><button data-button="quiet" onClick={() => void attempt(() => navigator.clipboard.writeText(String(saved.value.text ?? "")))}>{copy.copy}</button>
          <button data-button="quiet" onClick={() => drafts.discard(saved.revision)}>{copy.discardRevision}</button></span>
        </div>
      </Show>}</For>
      </div>
      <Show when={asking()}>
        <p class="light">{copy.askingTheDoor}</p>
      </Show>
      <Show when={menu.state() !== null || clearPrompt() !== null}>
        <Portal>
          <RailMenu menu={menu} />
          <Show when={clearPrompt()}>
            {(node) => (
              <div
                ref={(element) => {
                  clearElement = element;
                  const observer = new ResizeObserver(placeClear);

                  observer.observe(element);
                  queueMicrotask(placeClear);
                  onCleanup(() => { observer.disconnect(); clearElement = undefined; });
                }}
                class="rail-menu rail-clear" role="dialog" aria-label={copy.clearName(node().name)}
              >
                <ClearPrompt node={node()} />
              </div>
            )}
          </Show>
        </Portal>
      </Show>
      <div class="rail-actions">
        <button data-button="add"
          aria-label={copy.addWorkstream}
          class="word"
          aria-disabled={canSpawn() ? undefined : true}
          onClick={() => {
            if (canSpawn()) guarded(() => rail.createWorkstream());
          }}
        >
          <Icon name="plus" />{copy.addWorkstreamWord}</button>
      </div>
    </>
  );
};
