import { todoDropTargets } from "./todoDropTargets";
import { rowTypeahead } from "../ui/RowCollection";
import type { createCopyFeedback } from "../ui/CopyButton";
import { outcomeOf } from "../app/seam";
import { captureFocus, queueFocus } from "../keys/focus";
import { createDelegateBoard, TodoAuto } from "./DelegateBoard";
import { createOwnerAssignment, createOwnerKeys, createOwnerPicker, ownersToOffer } from "./ownerAssignment";
import { todoCreationEditor } from "../drawer/editors";
import ListChecks from "lucide-solid/icons/list-checks";
import { IconButton } from "../ui/IconButton";
import { contextMenu, linkEntries, openOnRelease } from "../ui/contextMenu";
import { registerKeys, type ActivationSource } from "../keys/registry";
import { copy } from "./copy";
import { shelfKeyScope, shelfRowKeys } from "../shelf/keys";
import { createBulkDelete, ShelfActions } from "../shelf/BulkDelete";
import { createSelection } from "../shelf/selection";
import { Progress } from "../ui/Progress";
import { createDependencyGroups } from "./dependencyGroups";
import { createCountMotion, createFinishMotion } from "./finishMotion";
import { Icon } from "../ink/Icon";
import { EmptyState } from "../ink/EmptyState";
import { EntryRow } from "../ink/EntryRow";
import * as v from "valibot";
import { TodoDraftRecovery, todoDraftSchema, creationSchema } from "./EditableText";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack, useContext, type JSX } from "solid-js";
import { useTabsContext } from "@ark-ui/solid/tabs";
import type { Todo } from "@contracts/todo/Todo";
import { ReservedLine } from "../ink/ReservedLine";
import { homesToOffer } from "./homes";
import { ShelfRow } from "../ink/ShelfRow";
import { KindGlyph } from "../ink/KindGlyph";
import { useConnectedProject, useCreation } from "../state/connectedProject";
import { failureOf } from "./failureOf";
import { OpenRow } from "./OpenRow";
import { RowButton } from "./RowButton";
import { createSortedList } from "./sortedList";
import { Sortable } from "../ui/sortable";
import { TreeView, Trunks } from "../ui/TreeView";
import { shelfScope, sameOwner, ownerGroups, ownersOnRail } from "../shelf/scope";
import { ScopeAction } from "../shelf/ScopeAction";
import { OwnerGroups } from "../shelf/OwnerGroups";
import { NewWorkstream } from "./NewWorkstream";
import { OwnerCommand, OwnerPicker } from "./OwnerPicker";
import type { Actor } from "@contracts/Actor";
import { CHORDS, TEXT_FIELDS, chordsFor, chordsOf } from "../keys/chords";
import { HomePicker } from "./HomePicker";
import { idOfRow, openRowButtons, rowButtonOf as triageRowOf, triage } from "./triage";
import type { TodosState } from "./state";
import { useTodoList } from "./todoList";
import { TodoDrawer } from "./TodoDrawer";
import { shownTodos } from "./shownTodos";
import { rowAfter, doneTodos, nowTodos, offeredAsBlockers, planDrop, treeCollection, treeRows, type NestedRow } from "./todoView";

/** U3513a: the keys the quiet footer shows; Help lists the rest. */
const QUIET_KEYS = ["J K", "A", "X"];

export const Todos = (props: {
  /** Open a retained creation form using this Project's already-loaded Todo facts. */
  recovery?: { project: string; revision: string; list: TodosState };
}) => {
  const connected = useConnectedProject();
  const shelf = useContext(ShelfActions);
  const tabs = shelf ? useTabsContext() : null;

  connected.drafts.validate("todos", todoDraftSchema);

  if (props.recovery && props.recovery.project !== connected.project.path) return null;

  const todos = props.recovery?.list ?? useTodoList();
  const copied = new Map<number, ReturnType<typeof createCopyFeedback>>();

  const registerCopy = (id: number) => (feedback: ReturnType<typeof createCopyFeedback>) => {
    copied.set(id, feedback);

    return () => { if (copied.get(id) === feedback) copied.delete(id); };
  };

  const retained = props.recovery ? connected.drafts.list().find(draft => draft.revision === props.recovery?.revision
    && draft.destination.surface === "todos" && draft.destination.object === "new") : undefined;

  const form = v.safeParse(creationSchema, retained?.value);
  const homeExists = (home: string | null) => home === null || connected.rail.nodes.some(node => node.id === home && node.kind === "workstream");

  if (props.recovery && (todos.project !== connected.project.path || !todos.isLoaded() || todos.failure() !== null || !retained || !form.success
    || retained.destination.recipient !== form.output.home || !homeExists(form.output.home))) return null;

  const [creationRevision, setCreationRevision] = createSignal<string | null>(retained?.revision ?? null);
  const [typing, setTyping] = createSignal(retained !== undefined);
  const [createFailure, setCreateFailure] = createSignal<string | null>(null);
  const [unfolded, setUnfolded] = createSignal(false);
  const wasDoneUnfolded = createMemo((mounted) => mounted || unfolded(), false);
  const scope = shelfScope(connected);
  const selectedWorkstream = scope.home;

  const active = () => (!shelf || shelf.open()) && (tabs === null || tabs().value === "todos");
  const board = createDelegateBoard();

  const open = shownTodos(connected, todos);

  const requested = createMemo(() => {
    const agent = connected.padsRequest();

    return active() && agent ? todos.all().filter(todo => todo.creator.kind === "agent" && todo.creator.id === agent) : [];
  });

  const includes = (todo: Todo) => scope.includes(todo.home, todo.creator, todo.owner)
    || (todo.creator.kind === "agent" && todo.creator.id === connected.padsOwner());

  const done = createMemo(() => doneTodos(todos.all()).filter(includes));

  const inScope = createMemo(() => todos.all().filter(includes));

  const now = createMemo(() => nowTodos(inScope(), todos.handed() ?? [], new Set(connected.rail.nodes.filter(node => node.kind === "agent").map(node => node.id))));

  // U362 Chromium profile: per-row ownerGroups rebuilt Rail order for 7 s on 200 Todos.
  const owners = createMemo(() => ownersOnRail(connected));
  const groupOf = (todo: Todo) => owners().find(owner => sameOwner(owner.actor, todo.owner))?.id ?? "unassigned";

  const dependencyRows = createMemo(() => ownerGroups(connected, inScope(), todo => todo.owner).flatMap(group => treeRows(group.items)));
  const memberIds = createMemo(() => new Set(dependencyRows().flatMap(row => row.parent === null ? [] : [row.todo.id, row.parent])));
  const foldedDone = createMemo(() => done().filter(todo => !memberIds().has(todo.id)));
  const rows = new Map<number, HTMLButtonElement>();
  const [closedGroups, setClosedGroups] = createSignal<readonly string[]>(["unassigned"]);

  const finishing = createFinishMotion({
    loaded: () => todos.isLoaded() && active(),
    key: () => connected.rail.selected() ?? "overview",
    done: createMemo(() => new Set(inScope().filter((todo) => todo.done).map((todo) => todo.id))),
    reduced: connected.reducedMotion,
    open: createMemo(() => open().map(todo => todo.id)),
    shown: (id, wasDone) => {
      if (!dependency.visible(id)) return false;

      if (wasDone && !memberIds().has(id)) return unfolded();

      const todo = inScope().find(todo => todo.id === id);

      return todo !== undefined && !closedGroups().includes(groupOf(todo));
    },
  });

  const dependency = createDependencyGroups({
    project: connected, key: () => connected.rail.selected() ?? "overview",
    keys: () => new Set(["overview", ...connected.rail.nodes.map(node => node.id)]),
    ids: () => new Set(todos.all().map(todo => todo.id)),
    loaded: () => todos.isLoaded() && active(),
    rows: createMemo(() => dependencyRows().map(row => ({ ...row, todo: { ...row.todo } }))),
    reduced: connected.reducedMotion,
    playing: () => !connected.reducedMotion() && (finishing.bar() || inScope().some(todo => finishing.row(todo.id))),
    group: id => groupOf(todos.byId().get(id)!),
    shown: id => {
      const todo = todos.byId().get(id);

      return !!todo && !closedGroups().includes(groupOf(todo));
    },
    focusAfterClose: hidden => {
      const kept = document.activeElement?.closest<HTMLElement>("[data-todo]");

      if (!kept || !hidden.has(Number(kept.dataset.todo))) return;
      const order = dependencyRows().map(row => row.todo.id);
      const at = order.indexOf(Number(kept.dataset.todo));

      queueFocus(() => {
        const active = document.activeElement;
        const current = active?.closest<HTMLElement>("[data-todo]");

        if (active && active !== document.body && (!current || !hidden.has(Number(current.dataset.todo)))) return;
        const candidates = [...order.slice(at + 1), ...order.slice(0, at).reverse()];

        const target = candidates.find(id => {
          const todo = todos.byId().get(id);

          return todo && !todo.done && !hidden.has(id) && dependency.visible(id) && !closedGroups().includes(groupOf(todo));
        });

        (target === undefined ? plusButton : rowButtonOf(target) ?? plusButton)?.focus();
      });
    },
  });

  // U3770: a Todo ticked in the open list stays in it, drawn done, until its motion ends, then moves to the done fold.
  const finishingRow = (todo: Todo) => todo.done && finishing.row(todo.id);

  const listed = createMemo(() => {
    const order = finishing.order();
    const kept = new Set([...order, ...memberIds()]);

    return inScope().filter(todo => kept.has(todo.id));
  });

  const selection = createSelection(() => [...listed().filter(todo => {
    return dependency.visible(todo.id) && !closedGroups().includes(groupOf(todo));
  }), ...(unfolded() ? foldedDone() : [])].map(todo => todo.id), () => connected.rail.selected() ?? "overview", id => rowButtonOf(id));

  const progressCount = createCountMotion(() => `${done().length}/${inScope().length}`, finishing.bar);

  const target = (todo: Todo) => ({ id: todo.id, label: todo.title, owner: todo.owner });

  const bulk = createBulkDelete({
    app: connected.app,
    rail: connected.rail,
    selected: selection.selected,
    afterRemoval: selection.afterRemoval,
    targets: () => [...open(), ...(unfolded() ? done() : [])].map(target),
    done: () => done().map(target),
    context: () => connected.rail.selected() ?? "overview",
    noun: copy.todos,
    replace: selection.replace, clear: selection.clear, cancelSelection: selection.cancel,
    blocked: () => connected.drafts.todoUndo.pending() || connected.drafts.todoUndo.uncertain(),
    remove: ids => connected.drafts.todoUndo.removeTodos(ids, shelf ? "shelf" : "todos"),
    reload: async () => {
      await todos.reload();

      return todos.failure();
    },
    reveal: () => setUnfolded(true),
  });

  shelfRowKeys({ focused: selection.focused, remove: id => bulk.ask(false, id) });

  const selectionKey = (todo: Todo, event: KeyboardEvent) => {
    bulk.key(event);

    if (!bulk.pending()) selection.key(todo.id, event);
  };

  const pending = createMemo(() => todos.pending().filter(includes));
  const isEmpty = createMemo(() => todos.isLoaded() && inScope().length === 0 && pending().length === 0);
  createEffect(() => {
    for (const todo of inScope()) if (finishing.row(todo.id) && (!dependency.visible(todo.id) || closedGroups().includes(groupOf(todo)))) finishing.rowEnded(todo.id);
  });

  const [dragging, setDragging] = createSignal(false);
  const [filed, setFiled] = createSignal(0);
  const [picking, pick] = createSignal<{ id: number; anchor: HTMLElement; focus?: ReturnType<typeof captureFocus> } | null>(null);
  const setPicking = (request: { id: number; anchor: HTMLElement } | null) => { pick(request && { ...request, focus: captureFocus(true) }); };

  let pickAdvance: ((permission?: ReturnType<typeof captureFocus>) => Promise<void>) | undefined;
  let commentAdvance: ((permission?: ReturnType<typeof captureFocus>) => Promise<void>) | undefined;
  const pickFails = new Map<number, { show: (message: string | null) => void; message: () => string | null; rename: () => void }>();

  const targets = todoDropTargets(connected, todos);

  const sorted = createSortedList({
    ids: () => open().map((todo) => todo.id),
    all: todos.all,
    reload: todos.reload,
    call: (params) => failureOf(() => connected.app.rpc("todo.reorder", params)),
    reducedMotion: connected.reducedMotion,
    home: {
      target: targets.home,
      move: (id, home) => failureOf(() => connected.app.rpc("todo.move", { id, home })),
    },
    owner: {
      target: targets.owner,
      assign: (id, owner) => failureOf(() => connected.app.rpc("todo.assign", { id, owner })),
    },
  });

  // U138, U3709: reordering retained DOM nodes can lose native focus without mounting a new button.
  let nestFocus: number | null = null;
  let nestGrip = false;
  let nestPermission = captureFocus();

  createEffect(() => {
    open().forEach(todo => todo.blockers.join());
    const id = nestFocus;

    if (id === null) return;
    queueMicrotask(() => {
      if (nestFocus !== id) return;
      nestFocus = null;

      if (document.activeElement === document.body || document.activeElement === null) nestPermission(() => (nestGrip ? rowButtonOf(id)?.closest(".todo-row")?.querySelector<HTMLElement>(".sortable-handle")
        : rowButtonOf(id))?.focus({ preventScroll: true }));
    });
  });

  /** U3709, U3711: Tab nests a row under the one above it and ⇧Tab un-nests it, each one `todo.setBlockers`; the Daemon refuses a cycle (T4). */
  const nestOf = (todo: Todo, parent: number | null, above: Todo | null, first: boolean) => {
    const call = (blockers: number[]) => async () => {
      sorted.stop();
      const advance = captureAdvance(todo.id);
      nestPermission = captureFocus();
      nestFocus = advance ? null : todo.id;
      nestGrip = false;

      const message = await failureOf(() => connected.app.rpc("todo.setBlockers", { id: todo.id, blockers }));

      if (message !== null) nestFocus = null;
      else await advance?.();

      return message;
    };

    return {
      in: first || above === null || parent === above.id || !offeredAsBlockers({ ...todo, blockers: [] }, todos.all()).some(other => other.id === above.id) ? null : call([above.id, ...todo.blockers.filter((id) => id !== above.id)]),
      out: parent === null ? null : call(todo.blockers.filter((id) => id !== parent)),
    };
  };

  /** U3710, U3711: a drop sets blockers, then order once that resolves; a refusal shows on the row and the Daemon's list stays. */
  const dropOf = async (rows: NestedRow[], flat: Todo[], id: number, parent: number | null, index: number) => {
    const plan = planDrop(rows, flat, todos.all(), id, parent, index);

    if (plan.blockers !== undefined) {
      const blockers = plan.blockers;
      nestPermission = captureFocus();
      nestFocus = id;
      nestGrip = true;
      const message = await failureOf(() => connected.app.rpc("todo.setBlockers", { id, blockers }));

      if (message !== null) {
        nestFocus = null;

        return sorted.show(id, message);
      }
    }

    if (plan.before !== undefined) sorted.show(id, await sorted.reorderTo(id, plan.before));
  };

  let plusButton: HTMLButtonElement | undefined;

  const rowButtonOf = triageRowOf;
  const requestedOpen = createMemo(() => requested().filter(todo => !todo.done));

  createEffect(() => {
    const items = requested();

    if (!items.length) return;

    if (items.some(todo => todo.done)) setUnfolded(true);

    if (requestedOpen().length) return;
    const first = items[0]!;

    queueFocus(() => {
      const target = rowButtonOf(first.id);

      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    });
    connected.finishPadsRequest();
  });

  /** U3720: the owner list closes with focus back on the row, found again after the refetch. */
  let namingNext: number | null = null;

  const stopPicking = () => {
    const id = picking()?.id;
    const skipRefocus = namingNext !== null || naming() !== null;

    pickAdvance = undefined;
    setPicking(null);

    // U3743: the dialog opens from the select callback, so the picker's close order cannot lose it; the row keeps no focus then.
    if (!skipRefocus && id !== undefined) queueFocus(() => rowButtonOf(id)?.focus());
  };

  // U3720: a chosen Todo moves to its new group's row once `todo.updated` has refetched, which replaces the row that had focus.
  const [naming, setNaming] = createSignal<number | null>(null);

  const { revealed, arrivals, setRevealed, setRegrouped, assign } = createOwnerAssignment({
    connected, todos, advance: () => pickAdvance, fail: (id, message) => pickFails.get(id)?.show(message),
  });

  const requestedGroups = createMemo(() => [...arrivals(), ...requestedOpen().map(groupOf)]);

  createOwnerPicker({ todos,
    when: event => (!triage.on() || triageTarget(event)?.done === false) && (triage.on() || !rowTypeahead(event)),
    pick: (id, anchor) => { setPicking({ id, anchor }); pickAdvance = captureAdvance(id); },
  });

  createOwnerKeys({ connected, todos, active, assign });

  const offers = () => ownersToOffer(connected, todos.byId().get(picking()?.id ?? -1));

  // U138: a completed Todo leaves the open list only once its `todo.updated` Event has refetched it, so the row to focus
  // is saved here until this list no longer carries `id`, then it is given to that target, else to the `+` button — but
  // only while focus is still unclaimed (null or the page body), so a request that outlives the user moving focus
  // elsewhere (typing in U16's field, Tab into the pane) never yanks it back.
  const [awaitingFocus, setAwaitingFocus] = createSignal<{ id: number; target: number | null; reopening: boolean; focus: ReturnType<typeof captureFocus> }[]>([]);

  createEffect(() => {
    const openIds = new Set(open().map((todo) => todo.id));
    const doneIds = new Set(done().map((todo) => todo.id));
    const remains = (request: { id: number; reopening: boolean }) => (request.reopening ? doneIds : openIds).has(request.id);
    const waiting = awaitingFocus();

    if (waiting.every(remains)) return;

    setAwaitingFocus(
      waiting.filter((request) => {
        if (remains(request)) return true;

        request.focus(() => {
          if (document.activeElement === null || document.activeElement === document.body) {
            const target = request.target !== null ? rows.get(request.target) : undefined;

            if (target && !target.closest("[hidden], [inert]")) target.focus();

            if (document.activeElement === null || document.activeElement === document.body) plusButton?.focus();
          }
        });

        return false;
      }),
    );
  });

  const [creationHome, setCreationHome] = createSignal<string | null>(form.success ? form.output.home : null);
  const [creationOwner, setCreationOwner] = createSignal<string | null>(form.success ? form.output.owner : null);
  const creationRecipient = creationHome;
  const creationTarget = () => ({ surface: "todos", object: "new", recipient: creationRecipient() });

  createEffect(() => {
    if (typing()) onCleanup(connected.drafts.editor(creationTarget()));
  });

  const creation = () => connected.drafts.list().findLast(draft => draft.destination.surface === "todos"
    && draft.destination.object === "new" && draft.destination.recipient === creationRecipient()
    && (creationRevision() !== null ? draft.revision === creationRevision() : (draft.status === "draft" || draft.status === "failed" || draft.status === "unknown" || draft.status === "pending")));

  createEffect(() => {
    const revision = creationRevision();

    if (typing() && revision !== null && !creation()) setTyping(false);
  });

  let creationRow: HTMLDivElement | undefined;

  registerKeys({ kind: "region", element: () => creationRow }, [{
    chords: ["Enter"],
    when: () => creation()?.status === "unknown" || creation()?.status === "pending",
    run: () => setCreateFailure(copy.draftStatus[creation()?.status ?? "unknown"]),
  }]);

  const retainCreation = (field: HTMLInputElement) => {
    const previous = creation();
    const caret = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };

    if (creationRevision() !== null && !previous) return;

    if (previous?.value.title === field.value) {
      if ((!props.recovery || document.activeElement === field) && JSON.stringify(previous.selection) !== JSON.stringify(caret)) connected.drafts.setSelection(previous.revision, caret);

      return;
    }

    if (field.value === "" && !previous) return;

    batch(() => setCreationRevision(connected.drafts.edit(creationTarget(), { title: field.value, home: creationHome(), owner: creationOwner() }, caret, "ordinary", creationRevision()).draft.revision));
  };

  // EntryRow clears after capturing this revision, so another Enter cannot submit it twice.
  const create = async (title: string) => {
    setCreateFailure(null);
    // Keep the owner captured when the scope-line field opened, even if selection changed.
    const owner: Actor | null = creationOwner() === null ? null : { kind: "agent", id: creationOwner()!, parent: null };

    const draft = creation();

    const home = creationHome();
    const recipient = creationRecipient();

    if (!homeExists(home) || !draft || !(await connected.drafts.submit(draft.revision))) return;

    if (creationRevision() === draft.revision) setCreationRevision(null);
    const field = document.querySelector<HTMLInputElement>(".todos-tab .entry-field");

    try {
      const made = await connected.app.rpc("todo.create", owner === null ? { title, body: null, blockers: null } : { title, body: null, blockers: null, owner });
      setFiled(count => count + 1);
      // Creation is acknowledged before placement: a failed move must never invite duplicate creation.
      connected.drafts.settle(draft.revision, "acknowledged");

      if (home !== null) await connected.app.rpc("todo.move", { id: made.id, home });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      connected.drafts.settle(draft.revision, outcomeOf(error));
      setCreateFailure(error.message);
      const retained = v.safeParse(v.string(), draft.value.title);

      // EntryRow clears on submit; restore only this field's unchanged failed revision.
      if (field?.isConnected && field.value === "" && creationRecipient() === recipient && (!creation() || creation()?.revision === draft.revision) && retained.success) { field.value = retained.output; setCreationRevision(draft.revision); }
    }
  };

  const openField = (home = selectedWorkstream(), owner = scope.agent()?.id ?? null) => {
    setCreateFailure(null);

    if (typing()) {
      document.querySelector<HTMLInputElement>(".todos-tab .entry-field")?.focus();

      return;
    }

    setCreationHome(home);
    setCreationOwner(owner);
    const draft = creation();
    const saved = v.safeParse(creationSchema, draft?.value);

    if (saved.success) setCreationOwner(saved.output.owner);

    if (draft && !v.safeParse(v.string(), draft.value.title).success) {
      setCreateFailure(copy.draftRetention(connected.project.name, copy.draftSurface("todos"), "invalid"));

      return;
    }

    setCreationRevision(draft?.revision ?? null);
    setTyping(true);
  };

  useCreation("todo", home => {
    setTyping(false);
    setCreationRevision(null);
    openField(home, null);
  });
  registerKeys(shelfKeyScope, [{ chords: ["n"],
    when: event => !event.repeat && !event.isComposing && event.target instanceof Element && section?.contains(event.target) === true && !event.target.closest(TEXT_FIELDS),
    run: () => openField(),
  }]);

  const field = () => (
    <div class="shelf-list todo-create" ref={element => { creationRow = element; }}>

      <EntryRow
        glyph={<input type="checkbox" class="todo-tick" disabled tabIndex={-1} aria-hidden="true" />}
        class="todo-inset"
        label={copy.newTodoTitle}
        placeholder={copy.newTodoPlaceholder}
        initial={untrack(() => {
          const draft = creation();
          const title = v.safeParse(v.string(), draft?.value.title);

          return { text: title.success ? title.output : "", selection: draft?.selection ?? null };
        })}
        onEdit={retainCreation}
        onSubmit={(title) => void create(title)}
        onClose={(reason) => {

          setTyping(false);

          if (reason === "escape") setCreateFailure(null);

          if (reason !== "blur") plusButton?.focus();
        }}
      />
      <ReservedLine message={createFailure()} content={createFailure() ? <>{copy.failed(copy.addTodo, "")}<span>{createFailure()}</span></> : undefined} />
    </div>
  );

  // U153: a row is selected while the Drawer it opened is the one open.
  const [shown, setShown] = createSignal<{ id: number; content: () => JSX.Element } | null>(null);
  const selectedId = () => (shown() !== null && connected.drawer.content() === shown()?.content ? shown()?.id : undefined);

  const show = (todo: Todo, source: ActivationSource, order = dependencyRows().filter(row => listed().some(todo => todo.id === row.todo.id) && dependency.visible(row.todo.id) && !closedGroups().includes(groupOf(row.todo)) || unfolded() && foldedDone().some(todo => todo.id === row.todo.id)).map(row => row.todo.id)) => {
    commentAdvance = captureAdvance(todo.id);

    const content = () => <TodoDrawer id={todo.id} todos={todos} order={order} onNavigate={id => { if (todos.byId().has(id)) show(todos.byId().get(id)!, "key", order); }} onComment={focus => focus(() => {
      if (!triage.on() || !commentAdvance) return;
      connected.drawer.close("key");
      void commentAdvance(captureFocus());
    })} />;

    setShown({ id: todo.id, content });
    connected.drawer.open(content, source, { kind: "todo", project: connected.project.path });
  };

  const toggle = async (todo: Todo, ids: readonly number[]) => {
    const focus = captureFocus();
    const reopening = todo.done;
    const advance = !reopening ? captureAdvance(todo.id) : undefined;
    const target = rowAfter(todo.id, ids);

    const message = await failureOf(() => reopening
      ? connected.app.rpc("todo.reopen", { id: todo.id })
      : connected.app.rpc("todo.complete", { id: todo.id }));

    if (message === null && advance) await advance();
    else if (message === null) setAwaitingFocus((waiting) => [...waiting, { id: todo.id, target, reopening, focus }]);

    return message;
  };

  // U3751 to U3754: Todo triage mode. One flag; every key runs today's action on the focused row.
  let section: HTMLElement | undefined;
  const triageButton = () => section?.closest(".shelf")?.querySelector<HTMLButtonElement>("[data-triage-toggle]") ?? section?.querySelector<HTMLButtonElement>("[data-triage-toggle]");

  const triageButtons = () => openRowButtons().filter(button => todos.byId().get(idOfRow(button) ?? -1)?.done === false);

  // U3474b: retain rendered order before a picker, editor or mutation can move the row.
  const captureAdvance = (id: number) => {
    if (!triage.on()) return undefined;
    const focus = captureFocus();
    const order = triageButtons().map(idOfRow);
    const at = order.indexOf(id);
    const candidates = [...order.slice(at + 1), ...order.slice(0, at).reverse(), id];

    return async (permission = focus) => {
      await todos.reload();

      if (triage.on()) finishing.settle();
      // Ark reconciles regrouped trees and dismisses the picker before the next paint.
      requestAnimationFrame(() => permission(() => {
        if (!triage.on() || !section?.isConnected || todos.failure() !== null) return;
        const kept = document.activeElement;

        if (kept instanceof Element && kept !== document.body && !kept.closest(".todos-tab, .owner-picker, .todo-comment-field, .todo-comments-send")) return;
        const visible = triageButtons();
        const next = candidates.map(candidate => visible.find(button => idOfRow(button) === candidate)).find(button => button !== undefined);
        (next ?? triageButton())?.focus();
      }));
    };
  };

  let entry: { id: number | undefined; order: (number | undefined)[] } | null = null;
  const [moving, move] = createSignal<{ id: number; anchor: HTMLElement; focus?: ReturnType<typeof captureFocus> } | null>(null);
  const setMoving = (request: { id: number; anchor: HTMLElement } | null) => move(request && { ...request, focus: captureFocus(true) });

  const homeOffers = () => homesToOffer(connected.rail.nodes, todos.byId().get(moving()?.id ?? -1)?.home ?? null);

  const stopMoving = () => {
    const id = moving()?.id;

    moveAdvance = undefined;
    setMoving(null);

    if (id !== undefined) queueFocus(() => triageRowOf(id)?.focus());
  };

  const enterTriage = () => {
    const buttons = triageButtons();
    const kept = idOfRow(document.activeElement);
    const start = kept !== undefined && todos.byId().get(kept)?.done === false ? triageRowOf(kept) : buttons[0] ?? null;

    entry = { id: idOfRow(start), order: buttons.map(idOfRow) };
    triage.set(true);
    (start ?? triageButton())?.focus();
  };

  /** U3751: the row that had focus at entry, else the nearest open one in the order the list had then. */
  const leaveTriage = () => {
    const kept = entry;

    entry = null;
    triage.set(false);

    if (!kept) return;

    const at = kept.order.indexOf(kept.id);
    const near = kept.order.flatMap((_, step) => [kept.order[at + step], kept.order[at - step]]);

    for (const id of near) {
      const button = id === undefined ? null : triageRowOf(id);

      if (button && !button.closest("[hidden], [inert]") && todos.byId().get(id!)?.done === false) return button.focus();
    }

    triageButton()?.focus();
  };

  createEffect(() => section?.closest(".shelf")?.setAttribute("data-triage", triage.on() ? "on" : "off"));
  createEffect(on(() => connected.rail.selected(), () => { entry = null; triage.set(false); }, { defer: true }));
  const activeTab = createMemo(() => tabs?.().value);
  createEffect(on(activeTab, () => { entry = null; triage.set(false); }, { defer: true }));
  onCleanup(() => { triage.set(false); section?.closest(".shelf")?.setAttribute("data-triage", "off"); });

  const clearFailures = () => pickFails.forEach(failure => failure.show(null));

  const triageTarget = (event: KeyboardEvent) => todos.byId().get(idOfRow(event.target instanceof Element ? event.target : null) ?? -1);

  const canTriage = (event: KeyboardEvent, nesting = false) => triage.canKey(event, section, !tabs || tabs().value === "todos", nesting);

  const triageKey = (keys: string, run: (todo: Todo, button: HTMLButtonElement, event?: KeyboardEvent) => void) => keys === "J K" ? {
    chords: chordsOf(CHORDS.find(row => row.inTriage && row.keys === keys)),
    when: (event: KeyboardEvent) => triage.on() && canTriage(event) && triageTarget(event)?.done === false,
    run: (event: KeyboardEvent) => {
      const found = triageTarget(event);

      if (found && event.target instanceof HTMLButtonElement) run(found, event.target, event);
    },
  } : {
    action: CHORDS.find(row => row.inTriage && row.keys === keys)!, searchable: false as const,
    when: (event: KeyboardEvent) => triage.on() && canTriage(event) && triageTarget(event)?.done === false,
    capture: (focus: Element | null) => {
      const id = idOfRow(focus);
      const todo = id === undefined ? undefined : todos.byId().get(id);

      return { available: () => triage.on() && active() && focus instanceof HTMLButtonElement && focus.isConnected && !focus.closest("[hidden], [inert]") && document.activeElement === focus && todo !== undefined && todos.byId().get(todo.id)?.done === false && (keys !== "W" || homesToOffer(connected.rail.nodes, todo.home).length > 0), invoke: () => { if (todo && focus instanceof HTMLButtonElement) run(todo, focus); } };
    },
  };

  const moveHome = async (id: number, home: string | null) => {
    const focus = captureFocus();
    const advance = moveAdvance;
    clearFailures();
    const message = await failureOf(() => connected.app.rpc("todo.move", { id, home }));

    pickFails.get(id)?.show(message);

    if (message === null && advance) await advance();
    else if (message === null) setAwaitingFocus(waiting => [...waiting, { id, target: rowAfter(id, triageButtons().map(idOfRow).filter(each => each !== undefined)), reopening: false, focus }]);
  };

  let moveAdvance: ((permission?: ReturnType<typeof captureFocus>) => Promise<void>) | undefined;

  registerKeys({ kind: "app" }, [
    {
      chords: [...CHORDS.filter(row => row.inTriage && row.keys !== "Esc").flatMap(row => chordsOf(row)), ...chordsFor("O")],
      when: event => triage.on() && canTriage(event, true) && triageTarget(event)?.done !== false && (!event.shiftKey || event.code === "Tab"),
      run: () => (triageButtons()[0] ?? triageButton())?.focus(),
    },
    {
      action: CHORDS.find(row => row.keys === "T")!, searchable: false,
      when: event => !triage.on() && canTriage(event) && !rowTypeahead(event),
      capture: focus => ({ available: () => !triage.on() && section?.isConnected === true && focus?.isConnected === true && (focus === document.body || !!focus.closest(".shelf, .shelf-tabs")) && !focus.closest("input,textarea,select,[contenteditable]") && (!tabs || tabs().value === "todos"), invoke: enterTriage }),
    },
    {
      action: CHORDS.find(row => row.inTriage && row.keys === "Esc")!, searchable: false,
      when: event => triage.on() && canTriage(event),
      capture: focus => ({ available: () => triage.on() && focus?.isConnected === true && (focus === document.body || !!focus.closest(".shelf, .shelf-tabs")) && !focus.closest("input,textarea,select,[contenteditable]"), invoke: leaveTriage }),
    },
    triageKey("J K", (_todo, button, event) => {
      const buttons = triageButtons();
      const at = buttons.indexOf(button);

      if (at !== -1) buttons[Math.min(buttons.length - 1, Math.max(0, at + (event?.code === "KeyJ" ? 1 : -1)))]?.focus();
    }),
    triageKey("A", (todo, button) => {
      clearFailures();
      setPicking({ id: todo.id, anchor: button });
      pickAdvance = captureAdvance(todo.id);
    }),
    triageKey("W", (todo, button) => {
      if (homesToOffer(connected.rail.nodes, todo.home).length === 0) return;
      clearFailures();
      setMoving({ id: todo.id, anchor: button });
      moveAdvance = captureAdvance(todo.id);
    }),
    triageKey("X", async (todo) => {
      clearFailures();
      pickFails.get(todo.id)?.show(await toggle(todo, triageButtons().map(idOfRow).filter(each => each !== undefined)));
    }),
    triageKey("C", (todo) => {
      if (selectedId() !== todo.id) show(todo, "key");
      triage.askComment(todo.id);
      commentAdvance = captureAdvance(todo.id);
    }),
  ]);

  /** U2694b: Complete (only for open Todos), Send to Agent ▸, Copy Link, Delete, as the system menu of a row; Delete asks as U461 does. */
  const todoMenu = (event: MouseEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-todo]") : null;
    const todo = row ? todos.byId().get(Number(row.dataset.todo)) : undefined;

    if (todo === undefined) return;

    const order = treeRows(ownerGroups(connected, listed(), item => item.owner).find(group => group.items.some(item => item.id === todo.id))?.items ?? []).map(row => row.todo.id);

    openOnRelease(event, (x, y) => void contextMenu(connected.app, [
      { id: "open", label: copy.openDraft, run: () => show(todo, "pointer") },
      ...(pickFails.get(todo.id)?.message() ? [{ id: "dismiss", label: copy.dismissFailure, run: () => pickFails.get(todo.id)?.show(null) }] : []),
      { id: "rename", label: copy.rename, run: () => pickFails.get(todo.id)?.rename() },
      { id: "assign", label: copy.assign, run: () => { const anchor = rowButtonOf(todo.id);

 if (anchor) setPicking({ id: todo.id, anchor }); } },
      ...(!todo.done ? [
        { id: "move-up", label: copy.moveUp, enabled: order.indexOf(todo.id) > 0, run: () => sorted.step(todo.id, -1, order) },
        { id: "move-down", label: copy.moveDown, enabled: order.indexOf(todo.id) < order.length - 1, run: () => sorted.step(todo.id, 1, order) },
      ] : []),
      { id: "move", label: copy.move, children: homesToOffer(connected.rail.nodes, todo.home).map(home => ({ id: `home:${home.home ?? "root"}`, label: home.name, run: () => moveHome(todo.id, home.home) })) },
      ...(!todo.done ? [{ id: "complete", label: copy.complete, run: () => void toggle(todo, open().map(candidate => candidate.id)) }] : []),
      ...linkEntries(connected.app, { kind: "todo", id: todo.id }, connected.rail.nodes, (node) => connected.rail.exitOf(node) === null, setCreateFailure, () => setCreateFailure(null), copied.get(todo.id)),
      { id: "delete", label: copy.delete, run: () => { selection.replace([todo.id]); bulk.ask(); } },
    ], x, y));
  };

  const groupAttributes = (id: number, level: number): JSX.HTMLAttributes<HTMLElement> => ({ role: "treeitem", "aria-level": level, "aria-expanded": dependency.expanded(id), "aria-controls": `todo-group-${id}`, "aria-owns": `todo-group-${id}` });

  return (
    <section aria-label={copy.todos} tabIndex={inScope().length === 0 ? 0 : undefined} class="todos-tab" onContextMenu={todoMenu} ref={section}>
      <OwnerCommand active={active} selected={() => selection.focused() ?? (selection.selected().length === 1 ? selection.selected()[0] : undefined)} todos={todos} connected={connected} assign={assign} />
      <ScopeAction tab="todos">
        <Show when={inScope().length > 0}>
          <div class="todo-progress" data-todo-progress>
            <Progress label={copy.todosDoneBar} max={inScope().length} value={done().length} motion={finishing.bar()} onMotionEnd={finishing.barEnded}>
              <span ref={progressCount} class="todo-progress-count" data-state="" data-todo-count>{done().length}/{inScope().length}</span>
            </Progress>
          </div>
        </Show>
        <button
          data-button="add"
          type="button"
          aria-label={copy.addTodoTo(scope.label())}
          class="shelf-add"
          ref={(button) => (plusButton = button)}
          onClick={() => openField()}
        >
          <Icon name="plus" />
          <span>{copy.todo}</span>
        </button>
        <IconButton class="shelf-triage" data-triage-toggle aria-label={copy.triage} aria-pressed={triage.on()} chord={CHORDS.find(row => row.keys === "T" && row.inShelf)} onClick={() => triage.on() ? leaveTriage() : enterTriage()}><ListChecks class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} /></IconButton>
        <TodoAuto home={selectedWorkstream} />
      </ScopeAction>
      <ReservedLine overlay message={todos.failure() || (!typing() ? createFailure() : null)} />
      <Show when={isEmpty() && !typing() && !todos.failure() && !createFailure()}>
        <EmptyState art="running" {...{ title: copy.noTodosYet }} line={copy.emptyTodosLine} action={<button type="button" data-button="primary" onClick={() => openField()}>{copy.addTodoWord}</button>} />
      </Show>
      <Show when={listed().length + pending().length > 0}>
        <OwnerGroups mark={group => <Show when={board.digit(group)}>{digit => <kbd class="todo-owner-digit">{digit()}</kbd>}</Show>} detail={group => <Show when={group.id === "unassigned" && connected.rail.nodes.find(node => node.id === selectedWorkstream())?.auto}><p class="todo-auto-handling">{copy.todoAutoHandling}</p></Show>} count={group => group.items.filter(todo => !todo.done).length} onClosedChange={setClosedGroups} groups={() => ownerGroups(connected, [...listed(), ...pending()], todo => todo.owner)} dragging={dragging} bare={() => connected.rail.nodes.find(node => node.id === connected.rail.selected())?.kind === "agent" ? connected.rail.selected() : null} reveal={revealed} focus={() => requestedOpen()[0] ? groupOf(requestedOpen()[0]!) : null} focusItem={() => rowButtonOf(requestedOpen()[0]?.id ?? -1)} onFocused={connected.finishPadsRequest} arrivals={requestedGroups} unfold={() => filed() + todos.revealed()}>{group => {
        const tree = createMemo(() => treeRows(group().items.filter(todo => !pending().includes(todo))));
        const collection = createMemo(() => treeCollection(tree()));
        const placeOf = (id: number) => tree().find((row) => row.todo.id === id) ?? { level: 1, parent: null };

        const renderChildren = (parent: number | null, trail: () => readonly boolean[] = () => []): JSX.Element => <For each={tree().filter(row => row.parent === parent).map(row => row.todo)}>{(todo, sibling) => {
            const at = () => tree().findIndex(row => row.todo.id === todo.id);
            const members = () => dependency.groups().get(todo.id) ?? [];
            let registered: HTMLButtonElement | null = null;
            const row = { get level() { return placeOf(todo.id).level; }, get parent() { return placeOf(todo.id).parent; }, get trail() { return this.level > 1 ? [...trail(), sibling() < tree().filter(row => row.parent === parent).length - 1] : []; } };

            return <Sortable.Item id={String(todo.id)} index={at()}>{parts => {
            const draw = (itemProps: () => JSX.HTMLAttributes<HTMLElement>) => (
            <OpenRow
              copyWith={registerCopy(todo.id)}
              disclosure={<Show when={members().length > 0}><TreeView.BranchTrigger asChild={trigger => <IconButton {...trigger({
                "aria-label": copy.toggleTodoGroup(todo.title), "aria-controls": `todo-group-${todo.id}`, "aria-expanded": dependency.expanded(todo.id),
                onClick: () => {
                  const content = document.getElementById(`todo-group-${todo.id}`);

                  if (dependency.expanded(todo.id) && content?.contains(document.activeElement)) document.querySelector<HTMLButtonElement>(`[data-group-toggle="${todo.id}"]`)?.focus();
                },
              })} aria-label={copy.toggleTodoGroup(todo.title)} data-group-toggle={todo.id}><Icon name={dependency.expanded(todo.id) ? "down" : "right"} /></IconButton>} /></Show>}
              aggregateMotion={dependency.strike(todo.id)}
              groupComplete={members().length ? dependency.complete(todo.id) : undefined}
              groupProgress={<Show when={members().length > 0}><Progress label={copy.todosDoneIn(todo.title)} max={members().length} value={members().filter(row => row.todo.done).length} motion={dependency.bar(todo.id)} onMotionEnd={() => dependency.barEnded(todo.id)}><span class="todo-progress-count" data-state="">{members().filter(row => row.todo.done).length}/{members().length}</span></Progress></Show>}
              current={now().has(todo.id)}
              motion={finishing.row(todo.id)}
              onMotionEnd={() => finishing.rowEnded(todo.id)}
              treeItem={itemProps()}
              todo={todo}
              selected={selection.selected().includes(todo.id) || selectedId() === todo.id}
              pressed={selection.selected().includes(todo.id)}
              selectionActive={selection.selected().length > 0}
              onPick={(item, event) => !bulk.pending() && selection.click(item.id, event)}
              onSelectionKey={selectionKey}
              known={todos.byId()}
              onOpen={show}
              onToggle={todo => toggle(todo, tree().map(row => row.todo.id))}
              onAssign={(item, anchor) => { setPicking({ id: item.id, anchor }); pickAdvance = captureAdvance(item.id); }}
              failWith={(show, message, rename) => pickFails.set(todo.id, { show, message, rename })}
              sorted={sorted.row(todo.id, parts, () => tree().map(({ todo }) => todo.id))}
              place={row} connections={<Trunks depth={row.level - 1} trail={row.trail} stem={members().length > 0 && dependency.expanded(todo.id)} />}
              nest={nestOf(todo, row.parent, tree().slice(0, at()).findLast(row => !row.todo.done)?.todo ?? null, at() === 0)}
              registerRow={(id, row) => {
                if (row) {
                  registered = row;
                  rows.set(id, row);
                  selection.register(id, row);
                } else if (rows.get(id) === registered) {
                  rows.delete(id);
                  selection.register(id, null);
                }
              }}
            />
            );

            return (
            <TreeView.NodeProvider node={collection().findNode(String(todo.id))!} indexPath={collection().getIndexPath(String(todo.id)) ?? []}>
            <Show when={members().length > 0} fallback={<TreeView.Item asChild={draw} />}>
              <TreeView.Branch asChild={branch => {
                const attrs = () => {
                  const { "aria-level": _level, "aria-expanded": _expanded, ...rest } = branch();

                  return rest;
                };

                return <div {...attrs()} class="todo-dependency" role="presentation" data-structural-motion={dependency.moving()} data-complete={dependency.complete(todo.id)}>
                {draw(() => groupAttributes(todo.id, row.level))}
                <TreeView.BranchContent id={`todo-group-${todo.id}`} inert={!dependency.expanded(todo.id)} aria-hidden={!dependency.expanded(todo.id)}><div class="todo-group-content">{renderChildren(todo.id, () => row.trail)}</div></TreeView.BranchContent>
                </div>;
              }} />
            </Show>
            </TreeView.NodeProvider>
              );
            }}</Sortable.Item>;
        }}</For>;

        return <>
        <For each={group().items.filter(todo => pending().includes(todo))}>{todo => <ShelfRow class="todo-row todo-inset" data-todo={todo.id} data-pending="true" glyph={<span><KindGlyph kind="idle" /></span>} head={<div class="row-head"><span class="shelf-title">{todo.title}</span></div>} />}</For>
        <TreeView.Root collection={collection()} expandedValue={collection().getBranchValues().filter(id => dependency.expanded(Number(id)))} onExpandedChange={details => {
          for (const id of collection().getBranchValues()) dependency.setExpanded(Number(id), details.expandedValue.includes(id));
        }}>
        <Sortable.Root class="todo-list shelf-list" plain ids={tree().map((row) => String(row.todo.id))} external={sorted.external} onDrag={setDragging} tree={{
          rows: tree().map((row) => ({ id: String(row.todo.id), parent: row.parent === null ? null : String(row.parent) })),
          get indent() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tree-step")) || 24; },
          inset: (element) => {
            const styles = getComputedStyle(element);

            return Number.parseFloat(styles.paddingInlineStart) - Number.parseFloat(styles.getPropertyValue("--space-2"));
          },
          nests: () => true,
          onMove: (move) => void dropOf(tree(), group().items.filter(todo => !pending().includes(todo)), Number(move.id), move.parent === null ? null : Number(move.parent), move.index),
          onPreview: () => undefined,
        }}>
        <TreeView.Tree aria-label={copy.todos} style={{ padding: "0" }}>
        {renderChildren(null)}
        </TreeView.Tree>
        </Sortable.Root>
        </TreeView.Root>
        </>; }}</OwnerGroups>
      </Show>
      <HomePicker target={moving} offers={homeOffers} choose={(id, home) => void moveHome(id, home)} close={stopMoving} />
      <OwnerPicker label={id => copy.ownersFor(id ?? "")} target={picking} offers={offers} choose={(id, owner) => void assign(id, owner)} close={stopPicking} newWorkstream={id => {
        const focus = captureFocus(true);
        namingNext = id;
        setTimeout(() => { namingNext = null; focus(() => setNaming(id)); }, 0);
      }} />
      <NewWorkstream target={naming} returnTo={rowButtonOf} done={(id, made, focus = captureFocus()) => {
        if (naming() !== id) return;
        setNaming(null);

        // U3743, U138: the Todo is the new Door's, so its row is found again once `todo.updated` has refetched it.
        if (made && pickAdvance) focus(() => void pickAdvance?.(captureFocus()));
        else if (made) {
          setRevealed("unassigned");
          setRegrouped({ id, owner: { kind: "agent", id: made.id, parent: null }, focus });
        } else queueFocus(() => rowButtonOf(id)?.focus());
      }} />
      <Show when={typing() ? creationHome() ?? connected.project.path : null} keyed>{_home => field()}</Show>
      <TodoDraftRecovery object="new" active={typing()} onDiscard={revision => {
        if (creation()?.revision === revision) setTyping(false);
      }} />
      <Show when={foldedDone().length > 0}>
        <div class="shelf-list">
        <Show when={wasDoneUnfolded()}>
          <div class="todo-done-fold" data-open={unfolded()} data-reduced-motion={connected.reducedMotion()} inert={!unfolded()}>
            <div class="todo-done-content">
            <For each={foldedDone().filter((todo) => !finishingRow(todo))}>
              {(todo) => (
                <OpenRow
                  copyWith={registerCopy(todo.id)}
                  todo={todo}
                  motion={finishing.row(todo.id)}
                  onMotionEnd={() => finishing.rowEnded(todo.id)}
                  known={todos.byId()}
                  onOpen={show}
                  onToggle={todo => toggle(todo, foldedDone().map(candidate => candidate.id))}
                  failWith={(show, message, rename) => pickFails.set(todo.id, { show, message, rename })}
                  selected={shown()?.id === todo.id}
                  pressed={selection.selected().includes(todo.id)}
                  selectionActive={selection.selected().length > 0}
                  onPick={(picked, event) => !bulk.pending() && selection.click(picked.id, event)}
                  onSelectionKey={selectionKey}
                  registerRow={(id, row) => {
                    selection.register(id, row);

                    if (row) rows.set(id, row); else rows.delete(id);
                  }}
                />
              )}
            </For>
            </div>
          </div>
        </Show>
          <ShelfRow glyph={<KindGlyph kind="done" decorative />} class="todo-inset">
            <div class="shelf-done-line">
              <RowButton hang={false} onClick={() => setUnfolded(!unfolded())}>
                <span class="shelf-title">{foldedDone().length}{copy.doneCount}</span>
              </RowButton>
              <button data-button="quiet" type="button" onClick={() => bulk.ask(true)}>{copy.clearDone}</button>
            </div>
          </ShelfRow>

        </div>
      </Show>
      <Show when={todos.isLoaded()}>
        <For each={[...new Set(connected.drafts.list().filter(draft => draft.destination.surface === "todos"
          && draft.destination.object !== "new" && !todos.byId().has(Number(draft.destination.object))).map(draft => draft.destination.object))]}>{object => <div>
          <ReservedLine message={copy.draftIdentity(copy.originalUnavailable, object)} />
          <TodoDraftRecovery object={object} />
        </div>}</For>
      </Show>
      <Show when={triage.on()}>
        <p class="triage-hints" aria-label={copy.triageKeys}>
          <For each={[...(open().length > 0 ? QUIET_KEYS.flatMap(keys => CHORDS.filter(row => row.inTriage && row.keys === keys)) : []), { keys: copy.questionMark, what: copy.triageMore }]}>{row =>
            <span class="triage-hint"><kbd class="triage-key">{row.keys}</kbd>{" "}{row.what}</span>}</For>
        </p>
      </Show>
      <bulk.Bar />
    </section>
  );
};

todoCreationEditor.set(Todos);
