import { rowTypeahead } from "../ui/RowCollection";
import { captureFocus } from "../keys/focus";
import type { Todo } from "@contracts/todo/Todo";
import { createComputed, createEffect, createSignal, on, type Accessor } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { ConnectedProject } from "../state/connectedProject";
import { ownersOnRail, sameOwner } from "../shelf/scope";
import type { TodosState } from "./state";
import { rowButtonOf } from "./triage";
import { registerKeys } from "../keys/registry";
import { CHORDS, TEXT_FIELDS } from "../keys/chords";
import { shelfKeyScope } from "../shelf/keys";
import { failureOf } from "./failureOf";

/** U3720: a hand-off unfolds its destination and restores the moved row's focus after the authoritative refetch. */
export const createOwnerAssignment = (source: {
  connected: ConnectedProject;
  todos: TodosState;
  advance: () => (() => Promise<void>) | undefined;
  fail: (id: number, message: string | null) => void;
}) => {
  const [revealed, setRevealed] = createSignal<string | null>(null);
  const [arriving, setArriving] = createSignal<readonly string[]>([]);
  const [regrouped, regroup] = createSignal<{ id: number; owner: Actor | null; focus: ReturnType<typeof captureFocus> } | null>(null);
  const setRegrouped = (request: { id: number; owner: Actor | null; focus?: ReturnType<typeof captureFocus> } | null) => regroup(request && { ...request, focus: request.focus ?? captureFocus() });

  createEffect(() => {
    const request = regrouped();
    const arrived = request && source.todos.byId().get(request.id);

    if (!request || !arrived || !sameOwner(arrived.owner, request.owner)) return;

    const id = request.id;

    queueMicrotask(() => {
      const kept = document.activeElement;

      if (kept && kept !== document.body && kept.isConnected && !kept.closest("[role=menu]")) return (setRegrouped(null), setRevealed(null));

      const button = rowButtonOf(id);

      if (button) {
        request.focus(() => button.focus());
        setRegrouped(null);
        setRevealed(null);
      }
    });
  });

  createComputed(on(() => source.todos.all().map(todo => ({ id: todo.id, owner: todo.owner ? { ...todo.owner } : null })), (next, previous) => {
    if (!previous) return;

    const groups = next.filter(todo => {
      const was = previous.find(each => each.id === todo.id);

      return was && !sameOwner(was.owner, todo.owner);
    }).map(todo => ownersOnRail(source.connected).find(owner => sameOwner(owner.actor, todo.owner))?.id ?? "unassigned");

    if (groups.length) {
      setArriving(groups);
      queueMicrotask(() => setArriving([]));
    }
  }));

  const assign = async (id: number, owner: Actor | null) => {
    const focus = captureFocus();
    const advance = source.advance();
    const message = await failureOf(() => source.connected.app.rpc("todo.assign", { id, owner }));

    source.fail(id, message);

    if (message === null && advance) await advance();
    else if (message === null) {
      // U3720, U138: the destination unfolds before its row exists, so focus has a button to land on.
      setRevealed(ownersOnRail(source.connected).find(each => sameOwner(each.actor, owner))?.id ?? "unassigned");
      regroup({ id, owner, focus });
    }
  };

  return { revealed, arrivals: arriving, setRevealed, setRegrouped, assign };
};

/** U3309: all keys share the Shelf registry; a lift chooses a destination without changing the Todo. */
export const createOwnerKeys = (source: {
  connected: ConnectedProject;
  todos: TodosState;
  active: Accessor<boolean>;
  assign: (id: number, owner: Actor | null) => Promise<void>;
}) => {
  const owners = () => ownersOnRail(source.connected);

  const focused = (button: Element | null) => {

    if (!(button instanceof HTMLButtonElement) || !button.matches(".todo-row-button") || !button.closest(".todos-tab")) return undefined;
    const todo = source.todos.byId().get(Number(button.closest<HTMLElement>("[data-todo]")?.dataset.todo));

    return todo?.done === false ? todo : undefined;
  };

  const can = (event: KeyboardEvent) => source.active() && !rowTypeahead(event) && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && focused(event.target instanceof Element ? event.target : null) !== undefined
    && !document.querySelector('.drawer[data-open="true"], [role=dialog], [role=alertdialog], [role=menu][data-state=open]');

  const action = CHORDS.find(row => row.keys === "1–9")!;

  registerKeys(shelfKeyScope, action.presses.map((press, at) => ({
    action, press, searchable: false as const, when: can,
    capture: (focus: Element | null) => {
      const todo = focused(focus);
      const target = owners().filter(owner => owner.actor?.kind === "agent")[at];

      return {
        label: `${at + 1} ${action.what}: ${target?.name ?? ""}`,
        available: () => source.active() && focus?.isConnected === true && document.activeElement === focus && todo !== undefined && focused(focus)?.id === todo.id
          && target !== undefined && owners().some(owner => sameOwner(owner.actor, target.actor))
          && !sameOwner(source.todos.byId().get(todo.id)?.owner ?? null, target.actor),
        invoke: () => { if (todo && target) void source.assign(todo.id, target.actor); },
      };
    },
  })));

};

/** U3720: assignment captures the focused Todo before opening its picker. */
export const createOwnerPicker = (source: {
  todos: TodosState;
  when: (event: KeyboardEvent) => boolean;
  pick: (id: number, anchor: HTMLElement) => void;
}) => {
  registerKeys(shelfKeyScope, [{
    action: CHORDS.find(row => row.keys === "O")!,
    when: source.when,
    capture: (focus) => {
      const row = focus instanceof HTMLElement && focus.closest(".row-head") && !focus.closest(".todo-row-actions") ? focus.closest<HTMLElement>("[data-shelf-row]") : null;
      const id = Number(row?.dataset.todo);
      const found = row && source.todos.byId().get(id);
      const anchor = focus instanceof HTMLElement && !focus.matches(TEXT_FIELDS) ? focus : null;

      return { available: () => !!found && !found.done && anchor !== null, invoke: () => { if (anchor) { source.pick(id, anchor); } } };
    },
  }]);
};

/** The available owners, leaving out the Todo's current owner. */
export const ownersToOffer = (connected: ConnectedProject, current: Todo | undefined) =>
  ownersOnRail(connected).filter(owner => !current || !sameOwner(owner.actor, current.owner));
