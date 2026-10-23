import { todoCreationEditor } from "../drawer/editors";
import ListChecks from "lucide-solid/icons/list-checks";
import { IconButton } from "../ui/IconButton";
import { contextMenu, linkEntries, openOnRelease } from "../ui/contextMenu";
import { registerKeys } from "../keys/registry";
import { activationSource } from "../keys/registry";
import type { ActivationSource } from "../keys/registry";
import { copy } from "../copy";
import { shelfKeyScope, shelfRowKeys } from "../shelf/keys";
import { createBulkDelete } from "../shelf/BulkDelete";

import { createSelection } from "../shelf/selection";
import { Progress } from "../ui/Progress";
import { createFinishMotion } from "./finishMotion";
import { Icon } from "../ink/Icon";
import { EmptyState } from "../ink/EmptyState";
import { EntryRow } from "../ink/EntryRow";
import * as v from "valibot";
import { batch, untrack } from "solid-js";
import { TodoDraftRecovery, todoDraftSchema, creationSchema } from "./EditableText";
import type { JSX } from "solid-js";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, useContext } from "solid-js";
import { useTabsContext } from "@ark-ui/solid/tabs";
import type { Todo } from "@contracts/todo/Todo";
import { ReservedLine } from "../ink/ReservedLine";
import { homesToOffer } from "./homes";
import { ShelfRow } from "../ink/ShelfRow";
import { KindGlyph } from "../ink/KindGlyph";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf, outcomeOf } from "./failureOf";
import { OpenRow } from "./OpenRow";
import { RowButton } from "./RowButton";
import { createSortedList } from "./sortedList";
import { Sortable } from "../ui/sortable";
import { TreeView } from "../ui/TreeView";
import { shelfScope } from "../shelf/scope";
import { ScopeAction } from "../shelf/ScopeAction";
import { OwnerGroups } from "../shelf/OwnerGroups";
import { NewWorkstream } from "./NewWorkstream";
import { OwnerPicker } from "./OwnerPicker";
import { ownerGroups, ownersOnRail, sameOwner } from "../shelf/scope";
import type { Actor } from "@contracts/Actor";
import { CHORDS, TEXT_FIELDS, chordsFor, chordsOf } from "../keys/chords";
import { KeyHint } from "../keys/KeyHint";
import { ShelfActions } from "../shelf/BulkDelete";
import { HomePicker } from "./HomePicker";
import { idOfRow, openRowButtons, rowButtonOf as triageRowOf, triage } from "./triage";
import type { TodosState } from "./state";
import { useTodoList } from "./todoList";
import { TodoDrawer } from "./TodoDrawer";
import { shownTodos } from "./shownTodos";
import { doneTodos, planDrop, treeCollection, treeRows, type NestedRow } from "./todoView";

/** U138: the row to focus once a completed Todo leaves the open list — the next one, else the previous, else none (the `+` button). */
export const rowAfter = (id: number, openIds: readonly number[]): number | null => {
  const at = openIds.indexOf(id);

  return openIds[at + 1] ?? openIds[at - 1] ?? null;
};

/** The Shelf's `todos` list: open Todos in id order, done ones folded, and the inline field that makes a new one. */
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

  const open = shownTodos(connected, todos);

  const selection = createSelection(() => [...open(), ...(unfolded() ? done() : [])].map((todo) => todo.id), () => connected.rail.selected() ?? "overview", id => rowButtonOf(id));

  const done = createMemo(() => doneTodos(todos.all()).filter((todo) =>
    scope.includes(todo.home, todo.creator, todo.owner)));

  const inScope = createMemo(() => todos.all().filter((todo) => scope.includes(todo.home, todo.creator, todo.owner)));

  const rows = new Map<number, HTMLButtonElement>();
  const [closedGroups, setClosedGroups] = createSignal<readonly string[]>(["unassigned"]);

  const finishing = createFinishMotion({
    loaded: () => todos.isLoaded() && (!shelf || shelf.open()) && (tabs === null || tabs().value === "todos"),
    key: () => connected.rail.selected() ?? "overview",
    done: createMemo(() => new Set(inScope().filter((todo) => todo.done).map((todo) => todo.id))),
    reduced: connected.reducedMotion,
    open: createMemo(() => open().map(todo => todo.id)),
    shown: (id, wasDone) => {
      if (wasDone) return unfolded();

      const todo = inScope().find(todo => todo.id === id);
      const group = todo && ownerGroups(connected, [todo], item => item.owner).find(group => group.items.length > 0);

      return group !== undefined && !closedGroups().includes(group.id);
    },
  });

  // U3770: a Todo ticked in the open list stays in it, drawn done, until its motion ends, then moves to the done fold.
  const held = (todo: Todo) => todo.done && finishing.row(todo.id);

  const listed = createMemo(() => finishing.order().flatMap(id => todos.byId().get(id) ?? []));

  let progressCount: HTMLSpanElement | undefined;

  createEffect(on(() => `${done().length}/${inScope().length}`, () => {
    if (!finishing.bar() || !progressCount) return;

    // Keep a burst's newest text moving from the visible pose, rather than replaying the roll's hidden start.
    const style = getComputedStyle(progressCount);
    const pose = { opacity: style.opacity, transform: style.transform };

    for (const animation of progressCount.getAnimations?.() ?? []) {
      if (animation.playState !== "running" || !(animation.effect instanceof KeyframeEffect)) continue;

      animation.effect.setKeyframes([{ ...pose, easing: animation.effect.getKeyframes()[0]!.easing }, { opacity: "1", transform: "none" }]);
      animation.currentTime = 0;
    }
  }, { defer: true }));

  const target = (todo: Todo) => ({ id: todo.id, label: todo.title });

  const bulk = createBulkDelete({
    selected: selection.selected,
    afterRemoval: selection.afterRemoval,
    targets: () => [...open(), ...(unfolded() ? done() : [])].map(target),
    done: () => done().map(target),
    context: () => connected.rail.selected() ?? "overview",
    noun: copy.todos,
    replace: selection.replace, clear: selection.clear, cancelSelection: selection.cancel,
    remove: (id) => failureOf(() => connected.app.rpc("todo.delete", { id })),
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

  const isEmpty = createMemo(() => todos.isLoaded() && todos.all().length === 0);

  /** The id of the group a Todo reads in: its owner, or Unassigned once that Agent left the Rail. */
  const groupOf = (todo: Todo) => ownerGroups(connected, [todo], item => item.owner).find(group => group.items.length > 0)!.id;
  const [dragging, setDragging] = createSignal(false);
  const [adding, setAdding] = createSignal<{ group: string; owner: Actor | null } | null>(null);
  const [picking, setPicking] = createSignal<{ id: number; anchor: HTMLElement } | null>(null);
  let pickAdvance: (() => Promise<void>) | undefined;
  let commentAdvance: (() => Promise<void>) | undefined;
  const pickFails = new Map<number, (message: string | null) => void>();

  const sorted = createSortedList({
    ids: () => open().map((todo) => todo.id),
    all: todos.all,
    call: (params) => failureOf(() => connected.app.rpc("todo.reorder", params)),
    reducedMotion: connected.reducedMotion,
    home: {
      target: (id, x, y) => {
        const current = todos.byId().get(id)?.home;
        const rail = document.querySelector(".rail");
        const clip = rail?.getBoundingClientRect();

        if (!clip || x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom) return null;

        for (const element of rail!.querySelectorAll<HTMLElement>(".rail-row[data-id], [data-todo-root]")) {
          const box = element.getBoundingClientRect();

          if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
          const home = element.hasAttribute("data-todo-root") ? null : element.dataset.id!;

          if (home === current || (home !== null && !connected.rail.nodes.some((node) => node.id === home && node.kind === "workstream"))) return null;

          return { element, home };
        }

        return null;
      },
      move: (id, home) => failureOf(() => connected.app.rpc("todo.move", { id, home })),
    },
    owner: {
      target: (id, x, y) => {
        const own = todos.byId().get(id);

        for (const element of document.querySelectorAll<HTMLElement>(".todos-tab [data-shelf-group]")) {
          const box = element.getBoundingClientRect();

          if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
          const group = element.dataset.shelfGroup!;
          const owner = ownersOnRail(connected).find(each => each.id === group);

          // A drop on the own group reorders (U155), and a group that left the Rail takes nothing.
          if (!owner || !own || group === groupOf(own)) return null;

          return { element, attribute: "data-drop-target", owner: owner.actor };
        }

        return null;
      },
      assign: (id, owner) => failureOf(() => connected.app.rpc("todo.assign", { id, owner })),
    },
  });

  // U138, U3709: reordering retained DOM nodes can lose native focus without mounting a new button.
  let nestFocus: number | null = null;

  createEffect(() => {
    open().forEach(todo => todo.blockers.join());
    const id = nestFocus;

    if (id === null) return;
    queueMicrotask(() => {
      if (nestFocus !== id) return;
      nestFocus = null;

      if (document.activeElement === document.body || document.activeElement === null) rows.get(id)?.focus();
    });
  });

  /** U3709, U3711: Tab nests a row under the one above it and ⇧Tab un-nests it, each one `todo.setBlockers`; the Daemon refuses a cycle (T4). */
  const nestOf = (todo: Todo, parent: number | null, above: Todo | null, first: boolean) => {
    const call = (blockers: number[]) => async () => {
      const advance = captureAdvance(todo.id);
      nestFocus = advance ? null : todo.id;

      const message = await failureOf(() => connected.app.rpc("todo.setBlockers", { id: todo.id, blockers }));

      if (message !== null) nestFocus = null;
      else await advance?.();

      return message;
    };

    return {
      in: first || above === null || parent === above.id ? null : call([above.id, ...todo.blockers.filter((id) => id !== above.id)]),
      out: parent === null ? null : call(todo.blockers.filter((id) => id !== parent)),
    };
  };

  /** U3710, U3711: a drop sets blockers, then order once that resolves; a refusal shows on the row and the Daemon's list stays. */
  const dropOf = async (rows: NestedRow[], flat: Todo[], id: number, parent: number | null, index: number) => {
    const plan = planDrop(rows, flat, todos.all(), id, parent, index);

    if (plan.blockers !== undefined) {
      const blockers = plan.blockers;
      const message = await failureOf(() => connected.app.rpc("todo.setBlockers", { id, blockers }));

      if (message !== null) return sorted.show(id, message);
    }

    if (plan.before !== undefined) sorted.show(id, await sorted.reorderTo(id, plan.before));
  };

  let plusButton: HTMLButtonElement | undefined;

  const rowButtonOf = triageRowOf;

  /** U3720: the owner list closes with focus back on the row, found again after the refetch. */
  let namingNext: number | null = null;

  const stopPicking = () => {
    const id = picking()?.id;
    const skipRefocus = namingNext !== null || naming() !== null;

    pickAdvance = undefined;
    setPicking(null);

    // U3743: the dialog opens from the select callback, so the picker's close order cannot lose it; the row keeps no focus then.
    if (!skipRefocus && id !== undefined) queueMicrotask(() => rowButtonOf(id)?.focus());
  };

  // U3720: a chosen Todo moves to its new group's row once `todo.updated` has refetched, which replaces the row that held focus.
  const [naming, setNaming] = createSignal<number | null>(null);
  const [revealed, setRevealed] = createSignal<string | null>(null);
  const [regrouped, setRegrouped] = createSignal<{ id: number; owner: Actor | null } | null>(null);

  createEffect(() => {
    const request = regrouped();
    const arrived = request && todos.byId().get(request.id);

    if (!request || !arrived || !sameOwner(arrived.owner, request.owner)) return;

    const id = request.id;

    queueMicrotask(() => {
      const held = document.activeElement;

      if (held && held !== document.body && held.isConnected && !held.closest("[role=menu]")) return (setRegrouped(null), setRevealed(null));

      const button = rowButtonOf(id);

      if (button) {
        button.focus();
        setRegrouped(null);
        setRevealed(null);
      }
    });
  });

  const assign = async (id: number, owner: Actor | null) => {
    const advance = pickAdvance;
    const message = await failureOf(() => connected.app.rpc("todo.assign", { id, owner }));

    pickFails.get(id)?.(message);

    if (message === null && advance) await advance();
    else if (message === null) {
      // U3720, U138: the destination unfolds before its row exists, so focus has a button to land on.
      setRevealed(ownersOnRail(connected).find(each => sameOwner(each.actor, owner))?.id ?? "unassigned");
      setRegrouped({ id, owner });
    }
  };

  registerKeys(shelfKeyScope, [{
    action: CHORDS.find(row => row.keys === "O")!,
    when: event => !triage.on() || triageTarget(event)?.done === false,
    capture: (focus) => {
      const row = focus instanceof HTMLElement && focus.closest(".row-head") && !focus.closest(".todo-row-actions") ? focus.closest<HTMLElement>("[data-shelf-row]") : null;
      const id = Number(row?.dataset.todo);
      const found = row && todos.byId().get(id);
      const anchor = focus instanceof HTMLElement && !focus.matches(TEXT_FIELDS) ? focus : null;

      return { available: () => !!found && !found.done && anchor !== null, invoke: () => { if (anchor) { pickAdvance = captureAdvance(id); setPicking({ id, anchor }); } } };
    },
  }]);

  const offers = () => {
    const current = todos.byId().get(picking()?.id ?? -1);

    return ownersOnRail(connected).filter(owner => !current || owner.id !== groupOf(current));
  };

  // U138: a completed Todo leaves the open list only once its `todo.updated` Event has refetched it, so the row to focus
  // is held here until this list no longer carries `id`, then it is given to that target, else to the `+` button — but
  // only while focus is still unclaimed (null or the page body), so a request that outlives the user moving focus
  // elsewhere (typing in U16's field, Tab into the pane) never yanks it back.
  const [awaitingFocus, setAwaitingFocus] = createSignal<{ id: number; target: number | null; reopening: boolean }[]>([]);

  createEffect(() => {
    const openIds = new Set(open().map((todo) => todo.id));
    const doneIds = new Set(done().map((todo) => todo.id));
    const remains = (request: { id: number; reopening: boolean }) => (request.reopening ? doneIds : openIds).has(request.id);
    const waiting = awaitingFocus();

    if (waiting.every(remains)) return;

    setAwaitingFocus(
      waiting.filter((request) => {
        if (remains(request)) return true;

        if (document.activeElement === null || document.activeElement === document.body) {
          const target = request.target !== null ? rows.get(request.target) : undefined;

          if (target && !target.closest("[hidden], [inert]")) target.focus();

          if (document.activeElement === null || document.activeElement === document.body) plusButton?.focus();
        }

        return false;
      }),
    );
  });

  const [creationHome, setCreationHome] = createSignal<string | null>(form.success ? form.output.home : null);
  const creationRecipient = () => adding() === null ? creationHome() : `${creationHome() ?? ""}/${adding()!.group}`;
  const creationTarget = () => ({ surface: "todos", object: "new", recipient: creationRecipient() });

  createEffect(() => {
    if (typing()) onCleanup(connected.drafts.editor(creationTarget()));
  });

  const creation = () => connected.drafts.list().findLast(draft => draft.destination.surface === "todos"
    && draft.destination.object === "new" && draft.destination.recipient === creationRecipient()
    && (creationRevision() !== null ? draft.revision === creationRevision() : draft.status === "draft"));

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

    batch(() => setCreationRevision(connected.drafts.edit(creationTarget(), { title: field.value, home: creationHome() }, caret, "ordinary", creationRevision()).draft.revision));
  };

  // EntryRow clears after capturing this revision, so another Enter cannot submit it twice.
  const create = async (title: string) => {
    setCreateFailure(null);
    // U3733: the top field under a selected Agent makes its Todo; a group's plus keeps its own group's owner.
    const owner = adding() ? adding()!.owner : scope.agent();

    const draft = creation();

    if (!homeExists(creationHome()) || !draft || !connected.drafts.submit(draft.revision)) return;
    setCreationRevision(null);
    const home = creationHome();
    const recipient = creationRecipient();
    const field = document.querySelector<HTMLInputElement>(".todos-tab .entry-field");

    try {
      const made = await connected.app.rpc("todo.create", owner === null ? { title, body: null, blockers: null } : { title, body: null, blockers: null, owner });
      // Creation is acknowledged before placement: a failed move must never invite duplicate creation.
      connected.drafts.settle(draft.revision, "acknowledged");

      if (home !== null) await connected.app.rpc("todo.move", { id: made.id, home });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      connected.drafts.settle(draft.revision, outcomeOf(error));
      setCreateFailure(error.message);
      const retained = v.safeParse(v.string(), draft.value.title);

      // EntryRow clears on submit; restore only this field's unchanged failed revision.
      if (field?.isConnected && field.value === "" && creationRecipient() === recipient && !creation() && retained.success) field.value = retained.output;
    }
  };

  /** U3719: an Agent group whose Agent left the Rail keeps its open field at the top, so the create fails as NOT_FOUND and says so. */
  const fieldGroupGone = () => adding() !== null && !ownersOnRail(connected).some(owner => owner.id === adding()?.group);

  /** U3719: the plus of a group header, or the top button (`null`), opens the one new-Todo field. */
  const openField = (next: { group: string; owner: Actor | null } | null) => {
    setCreateFailure(null);

    if (typing() && adding()?.group === next?.group) {
      document.querySelector<HTMLInputElement>(".todos-tab .entry-field")?.focus();

      return;
    }

    // U3719: one field is open at a time; opening another discards the first one's text.
    const previous = typing() ? creation() : undefined;

    batch(() => {
      if (previous) connected.drafts.discard(previous.revision);
      setCreationRevision(null);
    });

    setCreationHome(selectedWorkstream());
    setAdding(next);
    const draft = creation();

    if (draft && !v.safeParse(v.string(), draft.value.title).success) {
      setCreateFailure(copy.draftRetention(connected.project.name, copy.draftSurface("todos"), "invalid"));

      return;
    }

    setCreationRevision(draft?.revision ?? null);
    setTyping(true);
  };

  const field = () => (
    <div class="shelf-list todo-create" ref={element => { creationRow = element; }}>
      <ReservedLine overlay message={adding() !== null && !fieldGroupGone() ? createFailure() : null} />
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
          const group = adding()?.group;

          setTyping(false);
          setAdding(null);

          if (reason === "escape") setCreateFailure(null);

          if (reason !== "blur") (document.querySelector<HTMLElement>(`.todos-tab [data-shelf-group="${group}"] .shelf-group-add`) ?? plusButton)?.focus();
        }}
      />
    </div>
  );

  // U153: a row is selected while the Drawer it opened is the one open.
  const [shown, setShown] = createSignal<{ id: number; content: () => JSX.Element } | null>(null);
  const selectedId = () => (shown() !== null && connected.drawer.content() === shown()?.content ? shown()?.id : undefined);

  const show = (todo: Todo, source: ActivationSource) => {
    commentAdvance = captureAdvance(todo.id);

    const content = () => <TodoDrawer id={todo.id} todos={todos} onComment={() => {
      if (!triage.on() || !commentAdvance) return;
      connected.drawer.close("key");
      void commentAdvance();
    }} />;

    setShown({ id: todo.id, content });
    connected.drawer.open(content, source);
  };

  const toggle = async (todo: Todo, ids: readonly number[]) => {
    const reopening = todo.done;
    const advance = !reopening ? captureAdvance(todo.id) : undefined;
    const target = rowAfter(todo.id, ids);

    const message = await failureOf(() => reopening
      ? connected.app.rpc("todo.reopen", { id: todo.id })
      : connected.app.rpc("todo.complete", { id: todo.id }));

    if (message === null && advance) await advance();
    else if (message === null) setAwaitingFocus((waiting) => [...waiting, { id: todo.id, target, reopening }]);

    return message;
  };

  // U3751 to U3754: Todo triage mode. One flag; every key runs today's action on the focused row.
  let section: HTMLElement | undefined;
  const triageButton = () => section?.closest(".shelf")?.querySelector<HTMLButtonElement>("[data-triage-toggle]") ?? section?.querySelector<HTMLButtonElement>("[data-triage-toggle]");

  const triageButtons = () => openRowButtons().filter(button => todos.byId().get(idOfRow(button) ?? -1)?.done === false);

  // U3474b: retain rendered order before a picker, editor or mutation can move the row.
  const captureAdvance = (id: number) => {
    if (!triage.on()) return undefined;
    const order = triageButtons().map(idOfRow);
    const at = order.indexOf(id);
    const candidates = [...order.slice(at + 1), ...order.slice(0, at).reverse(), id];

    return async () => {
      await todos.reload();

      if (triage.on()) finishing.settle();
      // Ark reconciles regrouped trees and dismisses the picker before the next paint.
      requestAnimationFrame(() => {
        if (!triage.on() || !section?.isConnected || todos.failure() !== null) return;
        const held = document.activeElement;

        if (held instanceof Element && held !== document.body && !held.closest(".todos-tab, .owner-picker, .todo-comment-field, .todo-comments-send")) return;
        const visible = triageButtons();
        const next = candidates.map(candidate => visible.find(button => idOfRow(button) === candidate)).find(button => button !== undefined);
        (next ?? triageButton())?.focus();
      });
    };
  };

  let entry: { id: number | undefined; order: (number | undefined)[] } | null = null;
  const [moving, setMoving] = createSignal<{ id: number; anchor: HTMLElement } | null>(null);

  const homeOffers = () => homesToOffer(connected.rail.nodes, todos.byId().get(moving()?.id ?? -1)?.home ?? null);

  const stopMoving = () => {
    const id = moving()?.id;

    moveAdvance = undefined;
    setMoving(null);

    if (id !== undefined) queueMicrotask(() => triageRowOf(id)?.focus());
  };

  const enterTriage = () => {
    const buttons = triageButtons();
    const held = idOfRow(document.activeElement);
    const start = held !== undefined && todos.byId().get(held)?.done === false ? triageRowOf(held) : buttons[0] ?? null;

    entry = { id: idOfRow(start), order: buttons.map(idOfRow) };
    triage.set(true);
    (start ?? triageButton())?.focus();
  };

  /** U3751: the row that held focus at entry, else the nearest open one in the order the list had then. */
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

  const clearFailures = () => pickFails.forEach(show => show(null));

  const triageTarget = (event: KeyboardEvent) => {
    const id = idOfRow(event.target instanceof Element ? event.target : null);

    return id === undefined ? undefined : todos.byId().get(id);
  };

  const inTodos = (event: KeyboardEvent) => section?.isConnected === true && !section.closest("[hidden], [inert]") && (!tabs || tabs().value === "todos")
    && event.target instanceof Element && (event.target === document.body || event.target.closest(".shelf, .shelf-tabs") !== null);

  const canTriage = (event: KeyboardEvent, nesting = false) => inTodos(event) && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && (!event.shiftKey || nesting && event.code === "Tab")
    && event.target instanceof Element && !event.target.closest("input, textarea, select, [contenteditable]")
    && !document.querySelector("[role=dialog], [role=alertdialog], [role=menu][data-state=open]");

  const triageKey = (keys: string, run: (todo: Todo, button: HTMLButtonElement, event: KeyboardEvent) => void) => ({
    chords: chordsOf(CHORDS.find(row => row.inTriage && row.keys === keys)),
    when: (event: KeyboardEvent) => triage.on() && canTriage(event) && triageTarget(event)?.done === false,
    run: (event: KeyboardEvent) => {
      const found = triageTarget(event);

      if (found && event.target instanceof HTMLButtonElement) run(found, event.target, event);
    },
  });

  const moveHome = async (id: number, home: string | null) => {
    const advance = moveAdvance;
    clearFailures();
    const message = await failureOf(() => connected.app.rpc("todo.move", { id, home }));

    pickFails.get(id)?.(message);

    if (message === null && advance) await advance();
    else if (message === null) setAwaitingFocus(waiting => [...waiting, { id, target: rowAfter(id, triageButtons().map(idOfRow).filter(each => each !== undefined)), reopening: false }]);
  };

  let moveAdvance: (() => Promise<void>) | undefined;

  registerKeys({ kind: "app" }, [
    {
      chords: [...CHORDS.filter(row => row.inTriage && row.keys !== "Esc").flatMap(row => chordsOf(row)), ...chordsFor("O")],
      when: event => triage.on() && canTriage(event, true) && triageTarget(event)?.done !== false && (!event.shiftKey || event.code === "Tab"),
      run: () => (triageButtons()[0] ?? triageButton())?.focus(),
    },
    {
      chords: chordsFor("T"),
      when: event => !triage.on() && canTriage(event),
      run: enterTriage,
    },
    {
      chords: chordsOf(CHORDS.find(row => row.inTriage && row.keys === "Esc")),
      when: event => triage.on() && canTriage(event),
      run: leaveTriage,
    },
    triageKey("J K", (_todo, button, event) => {
      const buttons = triageButtons();
      const at = buttons.indexOf(button);

      if (at !== -1) buttons[Math.min(buttons.length - 1, Math.max(0, at + (event.code === "KeyJ" ? 1 : -1)))]?.focus();
    }),
    triageKey("A", (todo, button) => {
      clearFailures();
      pickAdvance = captureAdvance(todo.id);
      setPicking({ id: todo.id, anchor: button });
    }),
    triageKey("W", (todo, button) => {
      clearFailures();
      moveAdvance = captureAdvance(todo.id);
      setMoving({ id: todo.id, anchor: button });
    }),
    triageKey("X", async (todo) => {
      clearFailures();
      pickFails.get(todo.id)?.(await toggle(todo, triageButtons().map(idOfRow).filter(each => each !== undefined)));
    }),
    triageKey("C", (todo) => {
      commentAdvance = captureAdvance(todo.id);

      if (selectedId() !== todo.id) show(todo, "key");
      triage.askComment(todo.id);
    }),
  ]);

  /** U2694b: Complete (only for open Todos), Send to Agent ▸, Copy Link, Delete, as the system menu of a row; Delete asks as U461 does. */
  const todoMenu = (event: MouseEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-todo]") : null;
    const todo = row ? todos.byId().get(Number(row.dataset.todo)) : undefined;

    if (todo === undefined) return;

    openOnRelease(event, (x, y) => void contextMenu(connected.app, [
      ...(!todo.done ? [{ id: "complete", label: copy.complete, run: () => void toggle(todo, open().map(candidate => candidate.id)) }] : []),
      ...linkEntries(connected.app, { kind: "todo", id: todo.id }, connected.rail.nodes, (node) => connected.rail.exitOf(node) === null, setCreateFailure),
      { id: "delete", label: copy.delete, run: () => { selection.replace([todo.id]); bulk.ask(); } },
    ], x, y));
  };

  return (
    <section aria-label={copy.todos} class="todos-tab" onContextMenu={todoMenu} ref={section}>
      <ScopeAction tab="todos">
        <button
          data-button="add"
          type="button"
          aria-label={copy.addTodoTo(scope.label())}
          class="shelf-add"
          ref={(button) => (plusButton = button)}
          onClick={() => openField(null)}
        >
          <Icon name="plus" />
          <span>{copy.todo}</span>
        </button>
        <IconButton class="shelf-triage" data-triage-toggle aria-label={copy.triage} aria-pressed={triage.on()} chord={CHORDS.find(row => row.keys === "T" && row.inShelf)} onClick={() => triage.on() ? leaveTriage() : enterTriage()}><ListChecks class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} /></IconButton>
      </ScopeAction>
      <ReservedLine overlay message={(createFailure() !== null && (adding() === null || fieldGroupGone()) ? createFailure()! : null) || (todos.failure()) || null} />
      <Show when={isEmpty() && !typing()}>
        <EmptyState icon="check" heading={copy.noTodosYet} hint={copy.noTodosHint} />
      </Show>
      <Show when={inScope().length > 0}>
        <div class="todo-progress" data-todo-progress>
          <Progress label={copy.todosDoneBar} max={inScope().length} value={done().length} motion={finishing.bar()} onMotionEnd={finishing.barEnded}>
            <span ref={progressCount} class="todo-progress-count" data-state="" data-todo-count>{done().length}/{inScope().length}</span>
          </Progress>
        </div>
      </Show>
      <Show when={listed().length > 0 || adding() !== null}>
        <OwnerGroups count={group => group.items.filter(todo => !todo.done).length} onClosedChange={setClosedGroups} groups={() => ownerGroups(connected, listed(), todo => todo.owner)} dragging={dragging} bare={() => connected.rail.nodes.find(node => node.id === connected.rail.selected())?.kind === "agent" ? connected.rail.selected() : null} adding={() => adding()?.group ?? null} reveal={revealed} unfold={todos.revealed} onAdd={group => openField({ group: group.id, owner: group.actor })}>{group => {
        const tree = createMemo(() => treeRows(group().items));
        const collection = createMemo(() => treeCollection(tree()));
        const placeOf = (id: number) => tree().find((row) => row.todo.id === id) ?? { level: 1, parent: null };

        return <>
        <TreeView.Root collection={collection()}>
        <Sortable.Root class="todo-list shelf-list" plain ids={tree().map((row) => String(row.todo.id))} external={sorted.external} onDrag={setDragging} tree={{
          holdPlace: true,
          rows: tree().map((row) => ({ id: String(row.todo.id), parent: row.parent === null ? null : String(row.parent) })),
          get indent() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-4")) || 16; },
          nests: () => true,
          onMove: (move) => void dropOf(tree(), group().items, Number(move.id), move.parent === null ? null : Number(move.parent), move.index),
          onPreview: () => undefined,
        }}>
        <TreeView.Tree aria-label={copy.todos} style={{ padding: "0" }}>
        <For each={tree().map((row) => row.todo)}>
          {(todo, at) => {
            const row = { get level() { return placeOf(todo.id).level; }, get parent() { return placeOf(todo.id).parent; } };

            return (
            <Sortable.Item id={String(todo.id)} index={at()} pressable>
              {(parts) => (
            <TreeView.NodeProvider node={{ id: String(todo.id) }} indexPath={collection().getIndexPath(String(todo.id)) ?? []}>
            <TreeView.Item asChild={(itemProps) =>
            <OpenRow
              motion={finishing.row(todo.id)}
              onMotionEnd={() => finishing.rowEnded(todo.id)}
              treeItem={itemProps()}
              todo={todo}
              selected={selection.selected().includes(todo.id) || selectedId() === todo.id}
              pressed={selection.selected().includes(todo.id)}
              selectionActive={selection.selected().length > 0}
              onPick={(item, event) => !bulk.pending() && selection.click(item.id, event, () => show(item, activationSource(event)))}
              onSelectionKey={selectionKey}
              known={todos.byId()}
              onOpen={show}
              onToggle={todo => toggle(todo, tree().map(row => row.todo.id))}
              onAssign={(item, anchor) => { pickAdvance = captureAdvance(item.id); setPicking({ id: item.id, anchor }); }}
              failWith={(show) => pickFails.set(todo.id, show)}
              sorted={sorted.row(todo.id, parts, () => tree().map(({ todo }) => todo.id))}
              place={row}
              nest={nestOf(todo, row.parent, tree()[at() - 1]?.todo ?? null, at() === 0)}
              registerRow={(id, row) => {
                selection.register(id, row);

                if (row) rows.set(id, row);
                else rows.delete(id);
              }}
            />} />
            </TreeView.NodeProvider>
              )}
            </Sortable.Item>
          );}}
        </For>
        </TreeView.Tree>
        </Sortable.Root>
        </TreeView.Root>
        <Show when={typing() && !fieldGroupGone() && adding()?.group === group().id}>
          {field()}
        </Show>
        </>; }}</OwnerGroups>
      </Show>
      <HomePicker target={moving} offers={homeOffers} choose={(id, home) => void moveHome(id, home)} close={stopMoving} />
      <OwnerPicker label={id => copy.ownersFor(id ?? "")} target={picking} offers={offers} choose={(id, owner) => void assign(id, owner)} close={stopPicking} newWorkstream={id => { namingNext = id; setTimeout(() => { namingNext = null; setNaming(id); }, 0); }} />
      <NewWorkstream target={naming} returnTo={rowButtonOf} done={(id, made) => {
        setNaming(null);

        // U3743, U138: the Todo is the new Door's, so its row is found again once `todo.updated` has refetched it.
        if (made && pickAdvance) void pickAdvance();
        else if (made) {
          setRevealed("unassigned");
          setRegrouped({ id, owner: { kind: "agent", id: made.id, parent: null } });
        } else queueMicrotask(() => rowButtonOf(id)?.focus());
      }} />
      <Show when={typing() && (adding() === null || fieldGroupGone())}>
        {field()}
      </Show>
      <TodoDraftRecovery object="new" active={typing()} onDiscard={revision => {
        if (creation()?.revision === revision) setTyping(false);
      }} />
      <Show when={done().length > 0}>
        <div class="shelf-list">
        <Show when={wasDoneUnfolded()}>
          <div class="todo-done-fold" data-open={unfolded()} data-reduced-motion={connected.reducedMotion()} inert={!unfolded()}>
            <div class="todo-done-content">
            <For each={done().filter((todo) => !held(todo))}>
              {(todo) => (
                <OpenRow
                  todo={todo}
                  motion={finishing.row(todo.id)}
                  onMotionEnd={() => finishing.rowEnded(todo.id)}
                  known={todos.byId()}
                  onOpen={show}
                  onToggle={todo => toggle(todo, done().map(candidate => candidate.id))}
                  selected={shown()?.id === todo.id}
                  pressed={selection.selected().includes(todo.id)}
                  selectionActive={selection.selected().length > 0}
                  onPick={(picked, event) => !bulk.pending() && selection.click(picked.id, event, () => show(picked, activationSource(event)))}
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
                <span class="shelf-title">{done().length}{copy.doneCount}</span>
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
          <For each={CHORDS.filter(row => row.inTriage)}>{row => <KeyHint keys={row.keys}>{row.what}</KeyHint>}</For>
        </p>
      </Show>
      <bulk.Bar />
    </section>
  );
};

todoCreationEditor.set(Todos);
