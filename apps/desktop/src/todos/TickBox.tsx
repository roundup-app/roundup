import { copy } from "./copy";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { Todo } from "@contracts/todo/Todo";
import "./rowButton.styles.css";

/** U361/U461a: the native tick box in the Glyph's place; it completes or reopens the Todo. Reopening keeps the accepted check until refetch. */
export const TickBox = (props: { todo: Todo; onToggle: () => Promise<string | null>; motion?: boolean }) => {
  const [pending, setPending] = createSignal(false);
  // U5172a: once the call ends without a refusal, the state it asked for shows, marked busy, until the Daemon's Event or a re-read changes the Todo.
  // The state the call started from is kept, not read back when the call ends: an Event that already changed the Todo is not yet visible there.
  const [askedFrom, setAskedFrom] = createSignal<boolean | undefined>();
  const shown = () => askedFrom() === props.todo.done ? !props.todo.done : props.todo.done;
  // The click's own toggle stands while the call is out, and a change to what the Todo shows draws over it.
  const [boxed, setBoxed] = createSignal(shown);
  // A refused or repeated click puts the box back to what the Todo shows.
  const revert = (box: HTMLInputElement) => { box.checked = shown(); setBoxed(shown()); };

  createEffect(createMemo(() => props.todo.done), () => { setPending(false); setAskedFrom(undefined); }, { defer: true });

  return (
    <span class="todo-tick-box">
    <input
      type="checkbox"
      class="todo-tick glyph"
      aria-label={props.todo.done ? copy.reopenTodo(props.todo.title) : copy.completeTodo(props.todo.title)}
      checked={boxed()}
      aria-busy={pending() ? "true" : "false"}
      onChange={(event) => {
        const box = event.currentTarget;

        if (pending()) {
          revert(box);

          return;
        }

        const was = props.todo.done;
        setBoxed(box.checked);
        setPending(true);
        void props.onToggle().then((failure) => {
          if (failure !== null) {
            revert(box);
            setPending(false);
          } else setAskedFrom(was);
        });
      }}
    />
    {/* U3769: the tick is a stroke on the box, its dash offset runs 1 (hidden) to 0 (drawn); the input stays the one control. */}
    <svg class="todo-tick-mark" data-checked={String(shown())} data-motion={props.motion ? "play" : undefined} viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5 L6.8 11 L12 5.5" pathLength="1" /></svg>
    </span>
  );
};

