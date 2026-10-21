import { copy } from "../copy";
import { createEffect, createSignal, on } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import "./rowButton.styles.css";

/** Keeps the accepted value and focus while one done-state change awaits its Event. */
export const TickBox = (props: { todo: Todo; onToggle?: () => Promise<string | null> }) => {
  const [pending, setPending] = createSignal(false);
  createEffect(on(() => props.todo.done, () => setPending(false), { defer: true }));

  return (
    <input
      type="checkbox"
      class="todo-tick glyph"
      style={{ "outline-offset": "calc(-1 * var(--space-1))" }}
      aria-label={props.todo.done ? copy.reopenTodo(props.todo.title) : copy.completeTodo(props.todo.title)}
      aria-busy={pending()}
      checked={props.todo.done}
      onChange={(event) => {
        // A native toggle happens before change; restore the accepted value in the same event.
        event.currentTarget.checked = props.todo.done;

        if (pending() || !props.onToggle) return;
        setPending(true);
        void props.onToggle().then((failure) => {
          if (failure !== null) setPending(false);
        });
      }}
    />
  );
};
