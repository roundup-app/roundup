import { fireEvent, screen } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { openChanges } from "./noteHarness";
import { calls, counted, fresh, press, setUpView } from "./viewHarness";

setUpView();

// RS5: the picker beside the readback button lists the Agent's Skills and a start carries the choice, over a fake Daemon that answers `agent.skills`.

const treeOpen = async (names: string[]) => {
  const mounted = await mountControl(() => ({ files: [counted("a.ts", 1, 1)] }), fresh());

  mounted.app.handlers["agent.skills"] = () => ({ skills: names.map(name => ({ name, description: "" })) });
  mounted.app.handlers["agent.readback"] = () => ({ state: "notRead" });
  mounted.app.handlers["agent.readbackStart"] = () => ({ state: "reading" });
  await openChanges();
  await screen.findByRole("region", { name: copy.changes });
  fireEvent.click(await screen.findByRole("radio", { name: copy.targetTree }));
  await screen.findByRole("button", { name: copy.readBack });

  return mounted.app;
};

it("rs5_the_picker_lists_the_agents_skills_and_a_start_carries_the_choice", async () => {
  const app = await treeOpen(["security-review", "plugin:lint"]);

  fireEvent.click(await screen.findByRole("combobox", { name: copy.readbackSkill }));
  expect((await screen.findAllByRole("option")).map(option => option.textContent)).toEqual([copy.noSkill, "security-review", "plugin:lint"]);
  fireEvent.click(await screen.findByRole("option", { name: "security-review" }));
  press("r");
  await screen.findByText(copy.readingBack);
  expect(calls(app, "agent.readbackStart")).toBe(1);
  expect(app.calls.find(call => call.method === "agent.readbackStart")?.params).toMatchObject({ id: "a", group: expect.any(Object), skill: "security-review" });
});

it("rs5_a_start_with_no_choice_holds_no_skill_and_an_agent_with_none_shows_no_picker", async () => {
  const app = await treeOpen([]);

  expect(screen.queryByRole("combobox", { name: copy.readbackSkill })).toBeNull();
  press("r");
  await screen.findByText(copy.readingBack);
  expect(app.calls.find(call => call.method === "agent.readbackStart")?.params).toEqual({ id: "a", group: expect.any(Object) });
});

it("rs5_opening_the_view_starts_nothing", async () => {
  const app = await treeOpen(["security-review"]);

  await screen.findByRole("combobox", { name: copy.readbackSkill });
  expect(calls(app, "agent.readbackStart")).toBe(0);
  expect(calls(app, "agent.skills")).toBe(1);
});
