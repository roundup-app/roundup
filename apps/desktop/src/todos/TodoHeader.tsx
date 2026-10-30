import { createSignal } from "solid-js";
import { captureFocus } from "../keys/focus";
import { Portal } from "solid-js/web";
import type { Todo } from "@contracts/todo/Todo";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { CopyButton } from "../ui/CopyButton";
import { Menu } from "../ui/Menu";
import { useConnectedProject } from "../state/connectedProject";
import { ownersOnRail, sameOwner } from "../shelf/scope";
import { OwnerPicker } from "./OwnerPicker";
import { HomePicker } from "./HomePicker";
import { homeNameOf, homesToOffer } from "./homes";
import { copy } from "../copy";

/** Header actions retain the displayed Todo's authority and use the existing owner and Home pickers. */
export const TodoHeader = (props: {
  todo: Todo;
  order: readonly number[];
  navigate: (id: number) => void;
  remove: () => void;
  deleting: boolean;
  fail: (message: string | null) => void;
  registerOwner: (open: (anchor: HTMLButtonElement) => void) => void;
}) => {
  const connected = useConnectedProject();
  const [picking, pick] = createSignal<{ id: number; anchor: HTMLElement; focus: ReturnType<typeof captureFocus> } | null>(null);
  const setPicking = (target: { id: number; anchor: HTMLElement } | null) => pick(target && { ...target, focus: captureFocus(true) });
  const [moving, move] = createSignal<{ id: number; anchor: HTMLElement; focus: ReturnType<typeof captureFocus> } | null>(null);
  const setMoving = (target: { id: number; anchor: HTMLElement } | null) => move(target && { ...target, focus: captureFocus(true) });
  const [actions, setActions] = createSignal(false);
  const [agentsOnly, setAgentsOnly] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let afterActions: (() => void) | undefined;
  const assign = (anchor: HTMLButtonElement) => { if (!props.todo.done) { setAgentsOnly(false); setPicking({ id: props.todo.id, anchor }); } };

  props.registerOwner(assign);
  const offers = () => ownersOnRail(connected).filter(owner => !sameOwner(owner.actor, props.todo.owner) && (!agentsOnly() || owner.actor?.kind === "agent"));
  const at = () => props.order.indexOf(props.todo.id);

  const go = (step: number) => { const id = props.order[at() + step];

 if (at() >= 0 && id !== undefined) props.navigate(id); };

  const attempt = async (call: () => Promise<Todo>) => {
    try { await call(); props.fail(null); }
    catch (error) { if (!(error instanceof Error)) throw error; props.fail(error.message); }
  };

  const closePicker = () => { const anchor = picking()?.anchor; setPicking(null); anchor?.focus(); };

  const closeHome = () => { setMoving(null); trigger?.focus(); };

  return <>
    <header class="todo-header">
      <div class="todo-breadcrumb"><span>{connected.project.name}</span><Icon name="right" /><span class="todo-breadcrumb-title">{props.todo.title}</span></div>
      <div class="todo-header-actions">
        <IconButton data-todo-navigation aria-label="Previous Todo" disabled={at() <= 0} onClick={() => go(-1)}><Icon name="left" /></IconButton>
        <IconButton data-todo-navigation aria-label="Next Todo" disabled={at() < 0 || at() >= props.order.length - 1} onClick={() => go(1)}><Icon name="right" /></IconButton>
        <CopyButton class="word mono" app={connected.app} text={`#${props.todo.id}`} aria-label="Copy Todo id" onFailure={error => props.fail(error.message)}>#{props.todo.id}</CopyButton>
        <Menu.Root open={actions()} onOpenChange={({ open }) => setActions(open)} onExitComplete={() => {
          const open = afterActions;
          afterActions = undefined;
          open?.();
        }} onSelect={({ value }) => {
          if (value === "delete") props.remove();

          if (value === "owner") afterActions = () => { if (trigger) assign(trigger); };

          if (value === "hand") afterActions = () => { if (trigger && !props.todo.done) { setAgentsOnly(true); setPicking({ id: props.todo.id, anchor: trigger }); } };

          if (value === "home") afterActions = () => { if (trigger) setMoving({ id: props.todo.id, anchor: trigger }); };
        }}>
          <Menu.Trigger ref={element => { trigger = element; }} asChild={attributes => <IconButton {...attributes()} aria-label="More actions" onClick={() => setActions(true)}><Icon name="more" /></IconButton>} />
          <Portal><Menu.Positioner><Menu.Content aria-label="Todo actions">
            <Menu.Item value="owner" disabled={props.todo.done}>{copy.assign}</Menu.Item>
            <Menu.Item value="hand" disabled={props.todo.done || !ownersOnRail(connected).some(owner => owner.actor?.kind === "agent" && !sameOwner(owner.actor, props.todo.owner))}>Hand to an Agent</Menu.Item>
            <Menu.Item value="home">{copy.move} · {homeNameOf(connected.rail.nodes, props.todo.home)}</Menu.Item>
            <Menu.ItemGroup><Menu.ItemGroupLabel>Created by {props.todo.creator.kind === "user" ? copy.me : connected.rail.nameOf(props.todo.creator)}</Menu.ItemGroupLabel></Menu.ItemGroup>
            <Menu.Item value="delete" disabled={props.deleting}>{copy.deleteTodo}</Menu.Item>
          </Menu.Content></Menu.Positioner></Portal>
        </Menu.Root>
      </div>
    </header>
    <OwnerPicker target={picking} offers={offers} label={id => copy.ownersFor(id ?? "")} close={closePicker}
      choose={(id, owner) => { closePicker();

 if (!props.todo.done) void attempt(() => connected.app.rpc("todo.assign", { id, owner })); }} />
    <HomePicker target={moving} offers={() => homesToOffer(connected.rail.nodes, props.todo.home)} close={closeHome}
      choose={(id, home) => { closeHome(); void attempt(() => connected.app.rpc("todo.move", { id, home })); }} />
  </>;
};
