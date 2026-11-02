import { applied } from "../app/pending";
import { createMemo, createSignal, For } from "solid-js";
import { Portal } from "solid-js/web";
import type { Todo } from "@contracts/todo/Todo";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { Icon } from "../ink/Icon";
import { Menu } from "../ui/Menu";
import { TickBox } from "./TickBox";
import { BlockerMenu } from "./BlockerMenu";
import { blockerChoices, type blockerGraph } from "./todoView";

/** Both relation directions use the same picker and authoritative edge update. */
export const TodoMeta = (props: {
  todo: Todo;
  graph: ReturnType<typeof blockerGraph>;
  toggle: () => Promise<string | null>;
  change: (action: "add" | "remove", blocker: number, target?: Todo) => void;
  owner: string;
  assign: (anchor: HTMLButtonElement) => void;
  fail: (message: string | null) => void;
}) => {
  const { app } = useConnectedProject();
  const [offering, setOffering] = createSignal(false);
  const [blocking, setBlocking] = createSignal(false);
  let blockerButton: HTMLButtonElement | undefined;
  let blockingButton: HTMLButtonElement | undefined;
  const choices = createMemo(() => blockerChoices(props.todo, props.graph));
  const known = () => props.graph.known;

  const priorities = copy.todoPriorities;

  return <div class="todo-meta" aria-label={copy.todoDetails}>
    <span class="todo-meta-state"><TickBox todo={props.todo} onToggle={props.toggle} /></span>
    <Menu.Root onSelect={({ value }) => {
      const choice = priorities.find(priority => (priority.value ?? "unset") === value);

      if (!choice || choice.value === props.todo.priority) return;
      void applied(() => app.rpc("todo.update", { id: props.todo.id, title: null, body: null, priority: choice.value }))
        .then(() => props.fail(null), error => { if (!(error instanceof Error)) throw error; props.fail(error.message); });
    }}>
      <Menu.Trigger data-button="quiet" class="word todo-meta-chip" aria-label={copy.todoPriority}><Icon name="diamond" />{priorities.find(priority => priority.value === props.todo.priority)?.label}</Menu.Trigger>
      <Portal><Menu.Positioner><Menu.Content aria-label={copy.todoPriority}><For each={priorities}>{priority => <Menu.Item value={priority.value ?? "unset"}>{priority.label}</Menu.Item>}</For></Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
    <BlockerMenu open={offering()} onOpenChange={setOffering}
      label={copy.blockedByCount(choices().blockers.filter(todo => !todo.done).length)} icon={<Icon name="branch" />}
      related={choices().blockers} others={choices().offeredBlockers}
      buttonRef={element => { blockerButton = element; }}
      onPick={id => { blockerButton?.focus(); props.change("add", id); }}
      onRemove={id => { blockerButton?.focus(); props.change("remove", id); }} />
    <BlockerMenu open={blocking()} onOpenChange={setBlocking}
      label={copy.blockingCount(choices().blocking.filter(todo => !todo.done).length)} icon={<Icon name="branch" />}
      related={choices().blocking} others={choices().offeredBlocking}
      buttonRef={element => { blockingButton = element; }}
      onPick={id => { blockingButton?.focus(); const target = known().get(id);

 if (target) props.change("add", props.todo.id, target); }}
      onRemove={id => { blockingButton?.focus(); const target = known().get(id);

 if (target) props.change("remove", props.todo.id, target); }} />
    <button data-button="quiet" type="button" class="word todo-meta-chip" disabled={props.todo.done} onClick={event => props.assign(event.currentTarget)}><Icon name="bot" />{props.owner}</button>
  </div>;
};
