import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp, select } from "../testing/appFixture";
import { agent, clarifying } from "../testing/nodes";

it("u471_previous_copy_assertions_are_preserved_order_labels_use_sentence_case_and_preserve_agent_text", async () => {
  await mountApp((app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", "working", "editing", {
        name: "lower case Agent", order: 0,
        work: { kind: "work", ask: "keep v1 routes?", done: "routes stay", limits: [] },
      }),
      agent("b", "working", "editing", {
        name: "beta", order: 1, work: clarifying("keep v1 routes?"),
      }),
      agent("c", "idle", "waiting", { name: "gamma", order: 2 }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt: "keep this lower case" });
  });
  select("lower case Agent");
  const line = await screen.findByRole("button", { name: "Order of lower case Agent" });
  expect(line.textContent).toBe("keep v1 routes? · no limits");
  fireEvent.click(line);
  const drawer = await screen.findByLabelText("Full order of lower case Agent");
  expect(drawer.textContent).toContain("keep v1 routes?");
  expect(drawer.querySelector(".order-done")?.textContent).toBe("routes stay");
  expect(screen.getByRole("img", { name: "Not done" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));

  for (const label of ["Title", "Ask", "Done when"]) expect(screen.getByLabelText(label)).toBeTruthy();

  for (const name of ["Save", "Cancel"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  select("beta");
  await waitFor(() => expect(document.querySelector(".order-line")?.textContent).toBe("Clarifying: keep v1 routes?"));
});
