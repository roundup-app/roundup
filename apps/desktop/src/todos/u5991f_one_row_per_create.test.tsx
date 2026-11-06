// @vitest-environment jsdom
import { cleanup, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoEvent } from "./testHarness";

afterEach(cleanup);

const rowsTitled = (title: string) => [...document.querySelectorAll(".shelf-row")].filter(row => row.textContent?.includes(title)).length;

const frame = () => new Promise<void>(resolve => setTimeout(resolve));

/** U5991f: a Capture's shown row and the filed Todo it stands for never draw together, whichever of the list refresh and the reply comes first. */
it.each(["event before reply", "reply before event"] as const)("u5991f_a_capture_never_shows_two_rows_for_one_Todo_%s", async order => {
  const { app, store, todos } = await mountTodos([todo(1, { title: "Old" })]);
  const counts: number[] = [];

  const sample = async () => {
    await frame();
    counts.push(rowsTitled("Fresh"));
  };

  const hide = todos.show(todo(-1, { title: "Fresh" }));

  await sample();
  store.todos = [...store.todos, todo(2, { title: "Fresh" })];

  if (order === "event before reply") {
    app.emit(todoEvent("todo.created", todo(2, { title: "Fresh" })));
    await waitFor(() => expect(todos.all().some(each => each.id === 2)).toBe(true));
    await sample();
    hide();
    await sample();
  } else {
    await todos.reload();
    await sample();
    hide();
    await sample();
    app.emit(todoEvent("todo.created", todo(2, { title: "Fresh" })));
    await waitFor(() => expect(todos.all().some(each => each.id === 2)).toBe(true));
    await sample();
  }

  expect(counts.every(count => count === 1)).toBe(true);
});
