import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { event } from "../testing/nodes";
import { notice, notices } from "../testing/notices";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const toasts = () => screen.getByRole("region", { name: "Updates" });

/** The reserved lines the screen itself holds, empty or not: a failure has no place in it. */
const reservedLines = () => [...document.querySelectorAll(".message-body")].filter(line => !line.closest(".app-toasts"));

const elements = (root: Element) => [...root.querySelectorAll("*")];

/** A failed Todos list read is tried 5 times (U6249b) before its failure shows. */
const READ_ATTEMPTS = 5;

it("u7314f_todo_list_failures_show_as_toasts", async () => {
  const m = await mountTodos([todo(1)]);
  await screen.findByRole("button", { name: /^Idle #1 / });
  const shelf = document.querySelector(".todos-tab");

  if (!shelf) throw new Error("no Todos tab");

  const before = elements(shelf);
  expect(reservedLines()).toEqual([]);

  m.app.handlers["todo.list"] = () => Promise.reject(new Error("Daemon said no"));
  m.app.emit(event({ name: "todo.created", data: todo(2) }));
  const shown = await waitFor(() => notice("alert"));
  expect(notices("alert")).toEqual([shown]);
  expect(toasts().contains(shown)).toBe(true);
  expect(reservedLines()).toEqual([]);
  expect(elements(shelf)).toEqual(before);

  const reads = todoCallsTo(m.app, "todo.list").length;
  m.app.handlers["todo.list"] = () => [todo(1)];
  fireEvent.click(within(toasts()).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(todoCallsTo(m.app, "todo.list")).toHaveLength(reads + 1);
  expect(reservedLines()).toEqual([]);
  expect(elements(shelf)).toEqual(before);

  m.app.handlers["todo.list"] = () => Promise.reject(new Error("Still no"));
  m.app.emit(event({ name: "todo.created", data: todo(3) }));
  await waitFor(() => expect(notices("alert")).toHaveLength(1));
  expect(todoCallsTo(m.app, "todo.list").length).toBeGreaterThanOrEqual(reads + 1 + READ_ATTEMPTS);
  fireEvent.click(within(toasts()).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(notices("alert")).toEqual([]));
  expect(reservedLines()).toEqual([]);
  expect(elements(shelf)).toEqual(before);
});
