import { createMemo, createSignal, onCleanup, Show, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import type { ConnectedProject } from "../state/connectedProject";
import type { OwnerGroup } from "../shelf/scope";
import { DisplayClockContext } from "../state/clock";
import { Switch } from "../ui/Switch";
import { ReservedLine } from "../ink/ReservedLine";
import { failureOf } from "./failureOf";
import { copy } from "../copy";

/** U3308: one shared display clock, demanded only by the visible Board. */
export const createOwnerBoard = (connected: ConnectedProject, active: Accessor<boolean>, all: Accessor<readonly Todo[]>) => {
  const subscribe = useContext(DisplayClockContext);
  const now = subscribe ? subscribe(active) : connected.now;
  const minute = createMemo(() => Math.floor(now() / 60_000) * 60_000);
  const [preview, setPreview] = createSignal<{ id: number; group: string } | null>(null);

  const line = (group: OwnerGroup<Todo>) => {
    if (group.actor?.kind !== "agent") return "";
    const incoming = preview();
    const items = all().filter(todo => !todo.done && todo.owner?.kind === "agent" && todo.owner.id === group.id);
    const dragged = incoming?.group === group.id ? all().find(todo => todo.id === incoming.id) : undefined;

    if (dragged && !items.some(todo => todo.id === dragged.id)) items.push(dragged);
    const minutes = items.reduce((sum, todo) => sum + (todo.estimate_minutes ?? 0), 0);
    const missing = items.filter(todo => todo.estimate_minutes === null).length;
    const time = new Date(minute() + minutes * 60_000);
    const free = minutes === 0 ? copy.freeNow : copy.busyUntil(`${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`);

    return free + (missing === 0 ? "" : missing === items.length ? copy.noEstimates : copy.withoutEstimate(missing));
  };

  return { line, setPreview };
};

/** U3310: only the authoritative Workstream event changes the switch's state. */
export const Auto = (props: { connected: ConnectedProject; home: Accessor<string | null> }) => {
  const workstream = createMemo(() => props.connected.rail.nodes.find(node => node.kind === "workstream" && node.id === props.home()));
  onCleanup(props.connected.events.subscribe(event => {
    if (event.name === "workstream.updated") void props.connected.rail.refresh();
  }));

  const [failure, setFailure] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);

  return <Show when={workstream()}>{node => <div class="todo-auto">
    <Switch checked={node().auto ?? false} disabled={pending()} onCheckedChange={async auto => {
      setPending(true);
      setFailure(await failureOf(() => props.connected.app.rpc("workstream.setAuto", { id: node().id, auto })));
      setPending(false);
    }}>{copy.auto}</Switch>
    <span class="shelf-meta">{copy.autoExplanation}</span>
    <ReservedLine message={failure()} />
  </div>}</Show>;
};
