import { copy } from "../copy";
import { createEffect, createSignal, on } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import "./rowButton.styles.css";

/** U361/U461a: the native tick box in the Glyph's place; it completes or reopens the Todo. Reopening keeps the accepted check until refetch. */
export const TickBox = (props: { todo: Todo; onToggle: () => Promise<string | null> }) => {
  const [pending, setPending] = createSignal(false);

  createEffect(on(() => props.todo.done, () => setPending(false), { defer: true }));

  return (
    <input
      type="checkbox"
      class="todo-tick glyph"
      style={{ "outline-offset": "calc(-1 * var(--space-1))" }}
      aria-label={props.todo.done ? copy.reopenTodo(props.todo.title) : copy.completeTodo(props.todo.title)}
      checked={props.todo.done}
      aria-busy={pending()}
      onChange={(event) => {
        if (pending()) {
          event.currentTarget.checked = props.todo.done;

          return;
        }

        const box = event.currentTarget;
        box.checked = props.todo.done;
        setPending(true);
        void props.onToggle().then((failure) => {
          if (failure !== null) {
            box.checked = props.todo.done;
            setPending(false);
          }
        });
      }}
    />
  );
};

