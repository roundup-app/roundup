import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Pad } from "@contracts/pad/Pad";
import { answerQuestion } from "../shelf/bulkQuestionHarness";
import { todo } from "../todos/testHarness";
import { agent, event } from "../testing/nodes";
import { todoHandlers } from "../testing/stores";
import type { TodoStore } from "../testing/stores";
import { mountRail, rowOf } from "./railFixture";
import { fakeEmulators } from "../terminal/paneHarness";

afterEach(cleanup);

const REFUSED = "daemon said no";

const refuse = () => { throw new Error(REFUSED); };

const owned = (name: string, by: string): Pad => ({ incarnation: `fixture-${name}`, name, text: "old", updated_at: 0, revision: 1, home: null });

/** Row `a` fails to remove; the Rail's line is the failure. */
const failedRemove = async (pane = false) => {
  let tree = [agent("a", "idle", "x"), agent("b", "idle", "x", { order: 1 })];
  const mounted = await mountRail(tree, [], undefined, undefined, pane ? { pane: fakeEmulators().factory } : {});
  mounted.app.handlers["rail.tree"] = () => tree;
  mounted.app.handlers["rail.remove"] = refuse;
  mounted.app.handlers["terminal.snapshot"] = () => ({ data: "", cols: 100, rows: 30, after: 0 });
  mounted.app.handlers["terminal.resize"] = () => null;
  mounted.rail.select("a");
  rowOf("a").focus();
  fireEvent.keyDown(rowOf("a"), { key: "Backspace", code: "Backspace", metaKey: true });
  await answerQuestion(true);
  await waitFor(() => expect(screen.getByText(new RegExp(REFUSED))).toBeTruthy());

  return { ...mounted, drop: (id: string) => { tree = tree.filter((node) => node.id !== id); } };
};

describe("p3557c an item failure in the Rail goes with its item", () => {
  it("u3791c_same_scope_failure_replaces_across_command_sources", async () => {
    const { app, rail, drop, connected } = await failedRemove(true);
    const original = rail.commandFailure.message();
    const draft = connected.drafts.edit({ surface: "ask", object: "ask-bar", recipient: "b" }, { text: " unfinished 🌿 " }, null, "ordinary").draft;
    app.handlers["rail.createWorkstream"] = () => { throw new Error("new command failure"); };

    await rail.createWorkstream();
    await screen.findByRole("alert");
    expect(rail.commandFailure.message()).not.toBe(original);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    drop("a");
    await rail.refresh();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(connected.drafts.list()).toContainEqual(draft);
  });

  it("p3557c_failure_lifetime_rail_deleted_item_clears", async () => {
    const { rail, drop } = await failedRemove();
    drop("a");
    await rail.refresh();
    await waitFor(() => expect(screen.queryByText(new RegExp(REFUSED))).toBeNull());
    expect(rowOf("b")).toBeTruthy();
  });

  it("p3557c_failure_lifetime_rail_unrelated_deletion_keeps_it", async () => {
    const { rail, drop } = await failedRemove();
    drop("b");
    await rail.refresh();
    await waitFor(() => expect(screen.queryByText("b")).toBeNull());
    expect(screen.getByText(new RegExp(REFUSED))).toBeTruthy();
    expect(rowOf("a")).toBeTruthy();
  });

  it("p3557c_failure_lifetime_rail_acknowledged_retry_clears", async () => {
    const { app } = await failedRemove();
    app.handlers["rail.remove"] = () => null;
    fireEvent.keyDown(rowOf("a"), { key: "Backspace", code: "Backspace", metaKey: true });
    await answerQuestion(true);
    await waitFor(() => expect(screen.queryByText(new RegExp(REFUSED))).toBeNull());
  });

  it("p3557c_failure_lifetime_rail_dismissal_clears_it", async () => {
    await failedRemove();
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByText(new RegExp(REFUSED))).toBeNull());
    expect(rowOf("a")).toBeTruthy();
  });
});
