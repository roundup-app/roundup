import { createComputed, createEffect, createSignal, on } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { ConnectedProject } from "../state/connectedProject";
import { ownersOnRail, sameOwner } from "../shelf/scope";
import type { TodosState } from "./state";
import { rowButtonOf } from "./triage";
import { failureOf } from "./failureOf";
import { registerKeys, modalOpen } from "../keys/registry";
import { shelfKeyScope } from "../shelf/keys";
import { chordsFor } from "../keys/chords";
import { copy } from "../copy";

/** U3720: a hand-off unfolds its destination and restores the moved row's focus after the authoritative refetch. */
export const createOwnerAssignment = (source: {
  connected: ConnectedProject;
  todos: TodosState;
  advance: () => (() => Promise<void>) | undefined;
  fail: (id: number, message: string | null) => void;
}) => {
  const [revealed, setRevealed] = createSignal<string | null>(null);
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

  createComputed(on(() => source.todos.all().map(todo => ({ id: todo.id, owner: todo.owner })), (next, previous) => {
    if (!previous) return;

    for (const todo of next) {
      const was = previous.find(each => each.id === todo.id);

      if (was && !sameOwner(was.owner, todo.owner)) setRevealed(ownersOnRail(source.connected).find(each => sameOwner(each.actor, todo.owner))?.id ?? "unassigned");
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

  const [lifted, setLifted] = createSignal<{ id: number; group: string } | null>(null);

  const liftAnnouncement = () => {
    const lift = lifted();
    const owner = ownersOnRail(source.connected).find(owner => owner.id === lift?.group);

    return lift && owner ? copy.moveTodoTo(lift.id, owner.name) : "";
  };

  const focused = () => {
    const button = document.activeElement;
    const row = button?.matches(".todo-row-button") ? button.closest<HTMLElement>("[data-todo]") : null;
    const todo = row && source.todos.byId().get(Number(row.dataset.todo));

    return todo && !todo.done ? todo : null;
  };

  const can = (event: KeyboardEvent) => !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !modalOpen() && focused() !== null;

  const moveLift = (event: KeyboardEvent) => {
    const lift = lifted();

    if (!lift || !can(event)) return false;

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
    const offers = ownersOnRail(source.connected);
    const at = offers.findIndex(owner => owner.id === lift.group);
    const next = offers[Math.max(0, Math.min(offers.length - 1, at + (event.key === "ArrowUp" ? -1 : 1)))];

    if (next) setLifted({ id: lift.id, group: next.id });

    return true;
  };

  createEffect(on(() => source.connected.rail.selected(), () => setLifted(null), { defer: true }));
  registerKeys(shelfKeyScope, [{
    chords: chordsFor("1–9"), when: can, run: event => {
      const todo = focused();
      const owner = ownersOnRail(source.connected).filter(owner => owner.actor?.kind === "agent")[Number(event.key) - 1];

      setLifted(null);

      if (todo && owner && !sameOwner(todo.owner, owner.actor)) void assign(todo.id, owner.actor);
    },
  }, {
    chords: ["Enter"], when: can, run: () => {
      const todo = focused();
      const lift = lifted();

      if (!todo) return;

      if (!lift) {
        setLifted({ id: todo.id, group: ownersOnRail(source.connected).find(owner => sameOwner(owner.actor, todo.owner))?.id ?? "unassigned" });

        return;
      }

      const owner = ownersOnRail(source.connected).find(owner => owner.id === lift.group);

      setLifted(null);

      if (owner && !sameOwner(todo.owner, owner.actor)) void assign(todo.id, owner.actor);
    },
  }, {
    chords: ["Escape"], when: event => lifted() !== null && can(event), run: () => setLifted(null),
  }]);

  return { lifted, liftAnnouncement, moveLift, revealed, setRevealed, setRegrouped, assign };
};
