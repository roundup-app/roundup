import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream, NOW, event } from "../testing/nodes";
import { mountRail, rowNames, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const empty = { attempt: "1", turn: "1", finished: "1", kind: "empty" as const };

it("u5483a_working_idle_five_minutes_then_working_returns", async () => {
  const child = agent("child", "working", "working", { parent: "stream", final_text: empty });
  const { app, rail, setNow } = await mountRail([workstream("stream"), child, agent("busy", "working", "working", { parent: "stream", order: 1 })]);
  rail.select("child");
  const calls = app.calls.length;
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "2", status: { kind: "idle", label: "idle", since: NOW, finished: "1" } } }));
  setNow(NOW + 299_999);
  expect(rowNames()).toContain("child");
  setNow(NOW + 300_000);
  expect(rowNames()).toEqual(["stream", "busy"]);
  app.emit(event({ name: "agent.status", data: { id: "child", attempt: "1", status_revision: "3", status: { kind: "working", label: "working", since: NOW + 300_000, finished: "1" } } }));
  expect(rowNames()).toEqual(["stream", "child", "busy"]);
  expect(rail.selected()).toBe("child");
  expect(app.calls.slice(calls).filter(call => !["message.list", "pad.list", "todo.list"].includes(call.method))).toEqual([]);
});

it("u5483b_click_opens_and_closes_the_branch", async () => {
  await mountRail([workstream("stream"), agent("child", "done", "done", { parent: "stream", final_text: empty })]);
  const branch = () => screen.getByRole("treeitem", { name: /idle/ });
  expect(branch().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await settled();
  expect(rowNames()).toContain("child");
  fireEvent.click(branch().querySelector("[data-part=branch-control]")!);
  await settled();
  expect(rowNames()).not.toContain("child");
  expect(branch().getAttribute("aria-expanded")).toBe("false");
  expect(rowOf("stream")).toBeDefined();
});
