import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage } from "../testing/menuProbe";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each([true, false])("u4274b_landing_keeps_primary_navigation_and_attention: empty=%s", async empty => {
  const { daemon, connected } = await mountNavigation(empty);
  expect(document.querySelector(".todo-project-root")).not.toBeNull();
  expect(daemon.calls.filter(call => ["agent.spawn", "ask.send", "terminal.open"].includes(call.method))).toHaveLength(0);

  if (!empty) {
    expect(document.querySelector('[role="treeitem"][data-id="a0"]')).not.toBeNull();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".overview-entry")!);
    await waitFor(() => expect(connected().rail.selected()).toBe("a0"));
    await waitFor(() => expect(document.querySelector('.pane-screen [data-terminal="t-a0"]')).not.toBeNull());
  }
});

it("u4274b_secondary_surfaces_keep_the_rail_available", async () => {
  const { connected } = await mountNavigation();
  const rail = document.querySelector(".rail-tree");
  connected().rail.select("a1");
  await screen.findByRole("button", { name: "Back to Ask" });
  fireEvent.click(screen.getByRole("button", { name: "Back to Ask" }));
  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:ask-history", "/p");
  await waitFor(() => expect(connected().hasView("ask-history")).toBe(true));
  openProjectPage("view:ask-history", "/p");
  await waitFor(() => expect(connected().hasView("ask-history")).toBe(false));
  expect(document.querySelector(".rail-tree")).toBe(rail);
});
