import { createEffect, createSignal } from "solid-js";
import type { Actor } from "@contracts/Actor";
import type { ConnectedProject } from "../state/connectedProject";
import { ownersOnRail, sameOwner } from "../shelf/scope";
import type { TodosState } from "./state";
import { rowButtonOf } from "./triage";
import { failureOf } from "./failureOf";

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

  return { revealed, setRevealed, setRegrouped, assign };
};
