// @vitest-environment jsdom
// The historical filename is pinned by N7; this observer starts no Daemon.
import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
import { askToDelete, questionClosed } from "./bulkQuestionHarness";

afterEach(cleanup);

it("u460_bulk_delete_targets_only_the_chosen_rows_across_homes", async () => {
  const { app } = await mountTodos([
    todo(1, { home: "chosen-home" }),
    todo(2, { home: "chosen-home" }),
    todo(3, { home: "other-home", blockers: [1, 2], blocked: true }),
  ]);

  fireEvent.click(await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / }), { metaKey: true });
  await askToDelete(2);
  await questionClosed();
  expect(todoCallsTo(app, "todo.delete").map(call => call.params)).toEqual([{ operation: expect.any(String), ids: [1, 2] }]);
  expect(screen.queryByRole("button", { name: /^(?:Idle|Blocked|Done) #1 / })).toBeNull();
  expect(screen.queryByRole("button", { name: /^(?:Idle|Blocked|Done) #2 / })).toBeNull();
  expect(screen.getByRole("button", { name: /^(?:Idle|Blocked|Done) #3 / }).getAttribute("aria-pressed")).toBe("false");
});
