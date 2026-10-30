import { agent as agentNode } from "../testing/nodes";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo as callsTo, todoRowOf as rowOf } from "./testHarness";

afterEach(cleanup);

describe("u361 a Todo row holds a tick box, its title and what it waits on", () => {
  it("u361_a_branch_menu_completes_without_opening_or_reading", async () => {
    const { app } = await mountTodos([todo(3, { title: "ship it" }), todo(4, { title: "later", blocked: true, blockers: [3] })]);
    const row = await screen.findByRole("button", { name: /^(?:Idle|Blocked|Done) #3 ship it/ });

    fireEvent.contextMenu(row);
    await app.pickMenu("Complete");

    await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 3 } }]));
    expect(callsTo(app, "todo.get")).toEqual([]);
    expect(document.querySelector(".drawer")?.getAttribute("data-open")).toBe("false");

  });

  it("u361_a_successful_tick_box_waits_for_todo_updated_before_another_completion", async () => {
    const { app } = await mountTodos([todo(3)]);
    const box = await screen.findByRole<HTMLInputElement>("checkbox", { name: "Complete todo 3" });

    fireEvent.click(box);
    await waitFor(() => expect(callsTo(app, "todo.complete")).toHaveLength(1));
    fireEvent.click(box);
    fireEvent.click(box);

    expect(callsTo(app, "todo.complete")).toHaveLength(1);
    expect(within(rowOf(3)).getByRole("button", { name: /^(?:Idle|Blocked|Done) #\d+ todo 3/ })).toBeTruthy();
  });

});

it.each(["list", "agent-list", "drawer"].flatMap(surface => [false].map(done => ({ surface, done }))))("u461a_completion_pending_and_failure_preserve_accepted_value on $surface", async ({ surface, done }) => {
  const maker = { kind: "agent", id: "agent-1", parent: null } as const;
  const { app, connected } = await mountTodos([todo(1, { title: "ship", done, creator: maker })], true, [agentNode("agent-1", "idle", "ready")]);

  if (surface === "agent-list") connected.rail.select("agent-1");

  if (done) fireEvent.click(await screen.findByRole("button", { name: "1 done" }));

  if (surface === "drawer") { const focusedRow = await screen.findByRole("button", { name: `${done ? "Done" : "Idle"} #1 ship` }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }

  const area = surface === "drawer" ? within(document.querySelector<HTMLElement>(".drawer")!) : screen;
  const box = await area.findByRole<HTMLInputElement>("checkbox", { name: `${done ? "Reopen" : "Complete"} ship` });
  const method = done ? "todo.reopen" : "todo.complete";
  let reject!: (reason: Error) => void;
  app.handlers[method] = () => new Promise((_, fail) => { reject = fail; });
  box.focus();
  fireEvent.click(box);
  fireEvent.click(box);
  expect(callsTo(app, method)).toEqual([{ method, params: { id: 1 } }]);
  expect(box.checked).toBe(done);
  reject(new Error("Cannot reopen"));
  await area.findByText("Cannot reopen");
  expect(box.checked).toBe(done);
  expect(document.activeElement).toBe(box);
  app.handlers[method] = () => new Promise(() => {});
  fireEvent.click(box);
  expect(callsTo(app, method)).toHaveLength(2);
  expect(callsTo(app, done ? "todo.complete" : "todo.reopen")).toHaveLength(0);
});
