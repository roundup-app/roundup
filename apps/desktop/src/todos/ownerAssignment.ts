import type { Todo } from "@contracts/todo/Todo";
import { createComputed, createEffect, createSignal, on, type Accessor } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { ConnectedProject } from "../state/connectedProject";
import { ownersOnRail, sameOwner } from "../shelf/scope";
import type { TodosState } from "./state";
import { rowButtonOf } from "./triage";
import { registerKeys } from "../keys/registry";
import { CHORDS, chordsOf, chordsFor } from "../keys/chords";
import { shelfKeyScope } from "../shelf/keys";
import { copy } from "../copy";
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
  const [regrouped, setRegrouped] = createSignal<{ id: number; owner: Actor | null } | null>(null);

  createEffect(() => {
    const request = regrouped();
    const arrived = request && source.todos.byId().get(request.id);

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
    const advance = source.advance();
    const message = await failureOf(() => source.connected.app.rpc("todo.assign", { id, owner }));

    source.fail(id, message);

    if (message === null && advance) await advance();
    else if (message === null) {
      // U3720, U138: the destination unfolds before its row exists, so focus has a button to land on.
      setRevealed(ownersOnRail(source.connected).find(each => sameOwner(each.actor, owner))?.id ?? "unassigned");
      setRegrouped({ id, owner });
    }
  };

  return { revealed: () => [...arriving(), ...(revealed() === null ? [] : [revealed()!])], setRevealed, setRegrouped, assign };
};

/** U3309: all keys share the Shelf registry; a lift chooses a destination without changing the Todo. */
export const createOwnerKeys = (source: {
  connected: ConnectedProject;
  todos: TodosState;
  active: Accessor<boolean>;
  assign: (id: number, owner: Actor | null) => Promise<void>;
}) => {
  const [lifted, setLifted] = createSignal<{ id: number; group: string } | null>(null);
  const owners = () => ownersOnRail(source.connected);

  const focused = (event: KeyboardEvent) => {
    const button = event.target;

    if (!(button instanceof HTMLButtonElement) || !button.matches(".todo-row-button") || !button.closest(".todos-tab")) return undefined;
    const todo = source.todos.byId().get(Number(button.closest<HTMLElement>("[data-todo]")?.dataset.todo));

    return todo?.done === false ? todo : undefined;
  };

  const can = (event: KeyboardEvent) => source.active() && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && focused(event) !== undefined
    && !document.querySelector('.drawer[data-open="true"], [role=dialog], [role=alertdialog], [role=menu][data-state=open]');

  const drop = (todo: Todo, owner: Actor | null) => {
    setLifted(null);

    if (!sameOwner(todo.owner, owner)) void source.assign(todo.id, owner);
  };

  createEffect(on(() => [source.connected.rail.selected(), source.active()], () => setLifted(null), { defer: true }));
  registerKeys(shelfKeyScope, [{
    chords: chordsFor("1–9"), when: can,
    run: event => {
      const todo = focused(event);
      const target = owners().filter(owner => owner.actor?.kind === "agent")[Number(event.key) - 1];

      if (todo && target) drop(todo, target.actor);
    },
  }, {
    chords: chordsOf(CHORDS.find(chord => chord.keys === "⏎" && chord.inShelf)), when: can,
    run: event => {
      const todo = focused(event)!;
      const held = lifted();
      const target = owners().find(owner => owner.id === held?.group);

      if (held?.id === todo.id && target) drop(todo, target.actor);
      else setLifted({ id: todo.id, group: owners().find(owner => sameOwner(owner.actor, todo.owner))?.id ?? "unassigned" });
    },
  }, {
    chords: chordsFor("↑ ↓"), when: event => can(event) && lifted()?.id === focused(event)?.id,
    run: event => {
      const held = lifted()!;
      const all = owners();
      const at = all.findIndex(owner => owner.id === held.group);
      const target = all[Math.min(all.length - 1, Math.max(0, at + (event.key === "ArrowUp" ? -1 : 1)))];

      if (target) setLifted({ id: held.id, group: target.id });
    },
  }, {
    chords: chordsFor("Esc"), when: event => can(event) && lifted() !== null,
    run: () => setLifted(null),
  }]);

  return {
    lifted,
    announcement: () => {
      const held = lifted();
      const target = owners().find(owner => owner.id === held?.group);

      return held && target ? copy.todoMoveTo(held.id, target.name) : null;
    },
  };
};
