import { copy } from "../copy";
import { createSignal } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import "./rowButton.styles.css";

/** U361: the native tick box in the Glyph's place; checking it completes the Todo, and a failed call unchecks it. A done Todo's is checked and disabled. */
export const TickBox = (props: { todo: Todo; onComplete?: () => Promise<string | null> }) => {
  const [pending, setPending] = createSignal(false);

  return (
    <input
      type="checkbox"
      class="todo-tick glyph"
      style={{ "outline-offset": "calc(-1 * var(--space-1))" }}
      aria-label={copy.completeTodo(props.todo.title)}
      checked={props.todo.done}
      disabled={props.todo.done}
      onChange={(event) => {
        if (pending()) {
          event.currentTarget.checked = true;

          return;
        }

        if (!event.currentTarget.checked || !props.onComplete) return;
        const box = event.currentTarget;
        setPending(true);
        void props.onComplete().then((failure) => {
          if (failure !== null) {
            box.checked = false;
            setPending(false);
          }
        });
      }}
    />
  );
};

