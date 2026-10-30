import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";
import { USER } from "../testing/nodes";
import { askToDelete, confirmDeletion, stubDialogLayout } from "./bulkQuestionHarness";

afterEach(cleanup);

stubDialogLayout();

it("u460_agent_owned_pads_warn_and_delete_without_stopping_agents", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a"), padOf("mine", USER, "b")]);
  fireEvent.click(await screen.findByRole("button", { name: "notes" }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "mine" }), { metaKey: true });
  await askToDelete(2);
  await confirmDeletion();
  expect(app.calls.filter(call => call.method === "pad.delete").map(call => call.params)).toEqual(["notes", "mine"].map(name => ({ name, expectedIncarnation: `fixture-${name}`, operation: expect.any(String) })));
  expect(app.calls.filter(call => call.method === "agent.stop")).toEqual([]);
});

it("u460_open_pad_drawer_observes_bulk_delete", async () => {
  const { app, connected } = await openShelf([padOf("notes", USER, "body")]);
  const row = await screen.findByRole("button", { name: "notes" });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await screen.findByRole("button", { name: "Delete" });
  fireEvent.click(row, { metaKey: true });
  await askToDelete(1);
  await confirmDeletion();
  await screen.findByText(/Pad notes was deleted/);
  expect(connected.drawer.content()).not.toBeNull();
  expect(app.calls.filter((call) => call.method.startsWith("agent."))).toEqual([]);
});
