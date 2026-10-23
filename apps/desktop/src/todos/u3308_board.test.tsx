import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { agent } from "../testing/nodes";
import { mountTodos, todo, todoEvent } from "./testHarness";

afterEach(cleanup);

const owner = { kind: "agent" as const, id: "a", parent: null };

it("u3308_a_free_agent_reads_free_now", async () => {
  await mountTodos([todo(1, { owner })], true, [agent("a", "idle", "", { name: "Writer" })]);
  await waitFor(() => expect(screen.getByText(/free now/)).toBeTruthy());
});

const agents = [agent("a", "idle", "", { name: "Writer" })];

const line = () => document.querySelector('[data-shelf-group="a"] .shelf-owner-time')!.textContent;

it("u3308_busy_until_is_now_plus_the_sum_of_estimates", async () => {
  await mountTodos([todo(1, { owner, estimate_minutes: 45 }), todo(2, { owner, estimate_minutes: 15 })], true, agents, false, undefined, () => new Date(2026, 9, 23, 13, 40).getTime());
  expect(line()).toBe("busy until 14:40");
});

it("u3308_missing_estimates_add_nothing_and_say_so", async () => {
  const { app, store } = await mountTodos([todo(1, { owner, estimate_minutes: 45 }), todo(2, { owner })], true, agents, false, undefined, () => new Date(2026, 9, 23, 13, 40).getTime());
  expect(line()).toBe("busy until 14:25 + 1 without estimate");
  store.todos[0]!.estimate_minutes = null;
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await waitFor(() => expect(line()).toBe("free now · no estimates"));
});

it("u3308_done_todos_add_nothing", async () => {
  await mountTodos([todo(1, { owner, estimate_minutes: 30 }), todo(2, { owner, estimate_minutes: 90, done: true })], true, agents, false, undefined, () => new Date(2026, 9, 23, 13, 40).getTime());
  expect(line()).toBe("busy until 14:10");
});

it("u3308_the_line_follows_an_estimate_change_and_the_minute", async () => {
  const [now, setNow] = createSignal(new Date(2026, 9, 23, 13, 40).getTime());
  const { app, store } = await mountTodos([todo(1, { owner, estimate_minutes: 30 })], true, agents, false, undefined, now);
  store.todos[0]!.estimate_minutes = 45;
  app.emit(todoEvent("todo.updated", store.todos[0]!));
  await waitFor(() => expect(line()).toBe("busy until 14:25"));
  setNow(new Date(2026, 9, 23, 13, 41).getTime());
  await waitFor(() => expect(line()).toBe("busy until 14:26"));
});
