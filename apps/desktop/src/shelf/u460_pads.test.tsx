import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

it("u460_agent_owned_pads_warn_and_delete_without_stopping_agents", async () => {
  const { app } = await openShelf([padOf("notes", AGENT, "a"), padOf("mine", USER, "b")]);
  fireEvent.click(await screen.findByRole("button", { name: "notes" }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "mine" }), { metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
  expect(screen.getByText(/Agents may still be writing/).textContent).toContain("auth-refactor");
  expect(app.calls.filter((call) => call.method === "pad.delete")).toEqual([]);
});
