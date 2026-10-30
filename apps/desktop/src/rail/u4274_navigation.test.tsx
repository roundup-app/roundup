import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { copy } from "./copy";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage } from "../testing/menuProbe";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each([true, false])("u4274b_landing_keeps_primary_navigation_and_attention: empty=%s", async empty => {
  const { daemon, connected } = await mountNavigation(empty);
  expect(document.querySelector(".todo-project-root")).not.toBeNull();
  expect(daemon.calls.filter(call => ["agent.spawn", "ask.send", "terminal.open"].includes(call.method))).toHaveLength(0);

  if (!empty) {
    expect(document.querySelector('[role="treeitem"][data-id="a0"]')).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Agent 0/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(connected().rail.selected()).toBe("a0"));
    await waitFor(() => expect(document.querySelector('.pane-screen [data-terminal="t-a0"]')).not.toBeNull());
  }
});

it("u4274b_secondary_surfaces_keep_the_rail_available", async () => {
  const { connected } = await mountNavigation();
  const rail = document.querySelector(".rail-tree");
  connected().rail.select("a1");
  fireEvent.click(document.querySelector<HTMLElement>(".todo-project-root")!);
  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:made", "/p");
  await screen.findByRole("region", { name: "Made" });
  const heading = screen.getByRole("button", { name: copy.deliverables });
  heading.focus();
  await waitFor(() => expect(heading.hasAttribute("data-focus")).toBe(true));
  fireEvent.click(heading);
  await waitFor(() => expect(screen.queryByRole("region", { name: copy.deliverables })).toBeNull());
  expect(document.querySelector(".rail-tree")).toBe(rail);
});
