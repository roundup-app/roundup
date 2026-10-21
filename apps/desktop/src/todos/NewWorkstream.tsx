import { Portal } from "solid-js/web";
import { createMemo, createSignal, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { StartChoice } from "@contracts/workstream/StartChoice";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { useConnectedProject } from "../state/connectedProject";
import { Dialog } from "../ui/Dialog";
import { RadioGroup } from "../ui/RadioGroup";
import { Select } from "../ui/Select";
import { failureOf } from "./failureOf";
import { useTodoList } from "./todoList";

type Start = StartChoice["kind"];

const startChoices = (): readonly { value: Start; label: string }[] => [{ value: "now", label: copy.startNow }, { value: "queued", label: copy.startWhenSlotFrees }, { value: "afterTodo", label: copy.startAfterTodo }];

const startChoiceOf = (start: Start, todo: number | null): StartChoice => start === "afterTodo" ? { kind: start, todo: todo! } : { kind: start };

/** U3743: the dialog the owner picker's `New Workstream…` opens for Todo `target`. `Create` is the one `todo.startWorkstream` call; `done` runs after it with the Workstream made, or with `null` for Esc or `Cancel`, which call nothing. Esc or `Cancel` call nothing. */
export const NewWorkstream = (props: { target: Accessor<number | null>; done: (id: number, made: RailNode | null) => void; returnTo: (id: number) => HTMLElement | null }) => {
  const connected = useConnectedProject();
  const todos = useTodoList();

  return <Show when={props.target()}>{id => {
    const [name, setName] = createSignal(todos.byId().get(id())?.title ?? "");
    const [start, setStart] = createSignal<Start>(startChoices()[1]!.value);
    const [after, setAfter] = createSignal<string>("");
    const [failure, setFailure] = createSignal<string | null>(null);
    const [pending, setPending] = createSignal(false);
    const others = createMemo(() => todos.all().filter(todo => !todo.done && todo.id !== id()));
    const chosen = () => start() === "afterTodo" ? (others().find(todo => String(todo.id) === after())?.id ?? null) : null;
    const ready = () => name().trim() !== "" && (start() !== "afterTodo" || chosen() !== null) && !pending();

    const create = async () => {
      if (!ready()) return;

      setPending(true);
      setFailure(null);

      let made!: RailNode;
      const message = await failureOf(async () => { made = await connected.app.rpc("todo.startWorkstream", { id: id(), name: name().trim(), start: startChoiceOf(start(), chosen()) }); });

      setPending(false);

      if (message !== null) return setFailure(message);

      props.done(id(), made);
    };

    return <Dialog.Root open onOpenChange={({ open }) => { if (!open) props.done(id(), null); }} finalFocusEl={() => props.returnTo(id())}>
      <Portal><Dialog.Positioner>
        <Dialog.Content class="new-workstream" aria-label={copy.newWorkstreamTitle}>
          <form class="app-dialog-form" onSubmit={event => { event.preventDefault(); void create(); }}>
            <Dialog.Title>{copy.newWorkstreamTitle}</Dialog.Title>
            <label class="app-dialog-name">
              <span>{copy.workstreamNameLabel}</span>
              <input value={name()} aria-label={copy.workstreamNameLabel} onInput={event => setName(event.currentTarget.value)} />
            </label>
            <RadioGroup label={copy.startChoiceLabel} value={start()} onValueChange={setStart}
              choices={startChoices()} />
            <Show when={start() === "afterTodo"}>
              <Select label={copy.startAfterTodoLabel} value={after()} onValueChange={setAfter}
                choices={others().map(todo => ({ value: String(todo.id), label: `#${todo.id} ${todo.title}` }))} />
            </Show>
            <Show when={failure()}>{message => <ErrorLine message={message()} />}</Show>
            <div class="app-dialog-actions">
              <Dialog.CloseTrigger data-button="quiet">{copy.cancel}</Dialog.CloseTrigger>
              <button type="submit" data-button="primary" disabled={!ready()}>{copy.createWorkstream}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Positioner></Portal>
    </Dialog.Root>;
  }}</Show>;
};
