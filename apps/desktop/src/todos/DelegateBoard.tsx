import { createEffect, createMemo, createSignal, on, onCleanup, Show, type Accessor } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import type { OwnerGroup } from "../shelf/scope";
import { ownersOnRail } from "../shelf/scope";
import { useConnectedProject } from "../state/connectedProject";
import { Switch } from "../ui/Switch";
import { ReservedLine } from "../ink/ReservedLine";
import { failureOf } from "./failureOf";
import { copy } from "../copy";

/** U3309: number hints follow the same authoritative Rail order as owner assignment. */
export const createDelegateBoard = () => {
  const connected = useConnectedProject();
  const agents = createMemo(() => ownersOnRail(connected).filter(owner => owner.actor?.kind === "agent"));

  return {
    digit: (group: OwnerGroup<Todo>) => {
      const at = agents().findIndex(owner => owner.id === group.id);

      return at >= 0 && at < 9 ? at + 1 : null;
    },
  };
};

/** U3310: only the Workstream event changes the controlled switch's value. */
export const TodoAuto = (props: { home: Accessor<string | null> }) => {
  const connected = useConnectedProject();
  const current = createMemo(() => connected.rail.nodes.find(node => node.kind === "workstream" && node.id === props.home()));
  const [failure, setFailure] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  createEffect(on(() => current()?.id, () => setFailure(null)));
  onCleanup(connected.events.subscribe(event => {
    if (event.name === "workstream.updated") {
      if (event.data.id === current()?.id) setFailure(null);
      void connected.rail.refresh();
    }
  }));

  return <Show when={current()}>{node => <div class="todo-auto">
    <Switch description={copy.todoAutoHint} checked={node().auto ?? false} onCheckedChange={async auto => {
      if (pending()) return;
      const id = node().id;
      setPending(true);
      const message = await failureOf(() => connected.app.rpc("workstream.setAuto", { id, auto }));

      if (current()?.id === id) setFailure(message);
      setPending(false);
    }}>{copy.todoAuto}</Switch>
    <ReservedLine overlay message={failure()}><button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => setFailure(null)}>{copy.dismissFailure}</button></ReservedLine>
  </div>}</Show>;
};
