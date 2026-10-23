import { createEffect, createMemo, createSignal, on, onCleanup, Show, useContext, type Accessor } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import type { OwnerGroup } from "../shelf/scope";
import { ownersOnRail, sameOwner } from "../shelf/scope";
import { useConnectedProject } from "../state/connectedProject";
import { DisplayClockContext } from "../state/clock";
import { Switch } from "../ui/Switch";
import { ReservedLine } from "../ink/ReservedLine";
import { failureOf } from "./failureOf";
import { copy } from "../copy";

/** U3308/U3311: the shared display clock and authoritative Todo facts also drive drag previews. */
export const createDelegateBoard = (active: Accessor<boolean>, all: Accessor<readonly Todo[]>) => {
  const connected = useConnectedProject();
  // Embedded lists already receive their owner's clock; the App additionally supplies demand subscription.
  const now = useContext(DisplayClockContext)?.(active) ?? connected.now;
  const [preview, setPreview] = createSignal<{ id: number; group: string } | null>(null);
  const agents = createMemo(() => ownersOnRail(connected).filter(owner => owner.actor?.kind === "agent"));

  return {
    target: () => agents().find(owner => owner.id === preview()?.group),
    preview: setPreview,
    digit: (group: OwnerGroup<Todo>) => {
      const at = agents().findIndex(owner => owner.id === group.id);

      return at >= 0 && at < 9 ? at + 1 : null;
    },
    line: (group: OwnerGroup<Todo>) => {
      if (group.actor?.kind !== "agent") return null;
      const open = all().filter(todo => !todo.done && sameOwner(todo.owner, group.actor));
      const over = preview();
      const added = over?.group === group.id ? all().find(todo => todo.id === over.id) : undefined;

      if (added && !open.some(todo => todo.id === added.id)) open.push(added);
      const minutes = open.reduce((total, todo) => total + (todo.estimate_minutes ?? 0), 0);
      const missing = open.filter(todo => todo.estimate_minutes === null).length;
      const date = new Date(now() + minutes * 60_000);
      const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      const line = minutes === 0 ? copy.todoFreeNow : copy.todoBusyUntil(time);

      if (open.length > 0 && missing === open.length) return copy.todoNoEstimates;

      return missing === 0 ? line : `${line} ${copy.todoWithoutEstimates(missing)}`;
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
    <Switch checked={node().auto ?? false} onCheckedChange={async auto => {
      if (pending()) return;
      const id = node().id;
      setPending(true);
      const message = await failureOf(() => connected.app.rpc("workstream.setAuto", { id, auto }));

      if (current()?.id === id) setFailure(message);
      setPending(false);
    }}>{copy.todoAuto}</Switch>
    <span class="todo-auto-hint">{copy.todoAutoHint}</span>
    <ReservedLine overlay message={failure()}><button data-dismiss-failure onMouseDown={event => event.preventDefault()} data-button="quiet" class="word" type="button" onClick={() => setFailure(null)}>Dismiss failure</button></ReservedLine>
  </div>}</Show>;
};
