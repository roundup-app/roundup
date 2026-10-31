import { copy } from "./copy";
import { createEffect, createSignal, on } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import "./rowButton.styles.css";

/** U361/U461a: the native tick box in the Glyph's place; it completes or reopens the Todo. Reopening keeps the accepted check until refetch. */
export const TickBox = (props: { todo: Todo; onToggle: () => Promise<string | null>; motion?: boolean }) => {
  const [pending, setPending] = createSignal(false);
  // U5172a: once the call ends without a refusal, the asked state shows, marked busy, until the Daemon's Event or a re-read changes the Todo.
  const [asked, setAsked] = createSignal(false);
  const shown = () => asked() ? !props.todo.done : props.todo.done;

  createEffect(on(() => props.todo.done, () => { setPending(false); setAsked(false); }, { defer: true }));

  return (
    <span class="todo-tick-box">
    <input
      type="checkbox"
      class="todo-tick glyph"
      aria-label={props.todo.done ? copy.reopenTodo(props.todo.title) : copy.completeTodo(props.todo.title)}
      checked={shown()}
      aria-busy={pending()}
      onChange={(event) => {
        if (pending()) {
          event.currentTarget.checked = shown();

          return;
        }

        const box = event.currentTarget;
        setPending(true);
        void props.onToggle().then((failure) => {
          if (failure !== null) {
            box.checked = shown();
            setPending(false);
          } else setAsked(true);
        });
      }}
    />
    {/* U3769: the tick is a stroke on the box, its dash offset runs 1 (hidden) to 0 (drawn); the input stays the one control. */}
    <svg class="todo-tick-mark" data-checked={shown()} data-motion={props.motion ? "play" : undefined} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5 L6.8 11 L12 5.5" pathLength="1" /></svg>
    </span>
  );
};

