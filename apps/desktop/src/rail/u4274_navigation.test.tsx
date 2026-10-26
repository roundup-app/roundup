import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mount } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

it.each([false, true])("u4274b_landing_keeps_primary_navigation_and_attention: empty=%s", async empty => {
  const { daemon, connected } = await mount(empty);
  expect(screen.getByRole("tree")).toBeDefined();
  expect(screen.getByRole("textbox")).toBeDefined();
  expect(document.querySelector('.todos-tab, .pads-tab, .resource-value, .ask-rows, .reactions, .made-list')).toBeNull();
  expect(daemon.calls.filter(call => ["agent.spawn", "ask.send", "terminal.open"].includes(call.method))).toHaveLength(0);

  if (!empty) {
    fireEvent.click(document.querySelector<HTMLButtonElement>(".overview-entry")!);
    await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a0"));
    expect(connected().rail.selected()).toBe("a0");
  }
});

it.each(["ask-history", "resources", "reactions", "made"])("u4274b_secondary_surfaces_keep_the_rail_available: %s", async view => {
  const { connected } = await mount();

  if (view === "resources") {
    expect(projectMenu.items.find(item => item.id === "view:resources")?.enabled).toBe(false);
    connected().rail.select("a0");
    await waitFor(() => expect(projectMenu.items.find(item => item.id === "view:resources")?.enabled).toBe(true));
  }

  openProjectPage(`view:${view}`, "/p");
  await waitFor(() => expect(connected().view()).toBe(view));
  openProjectPage(`view:${view}`, "/p");
  await waitFor(() => expect(connected().view()).toBeNull());

  if (view === "resources") fireEvent.click(screen.getByRole("button", { name: "Back to Ask" }));
  expect(document.querySelector(".ask-input")).not.toBeNull();
  expect(screen.getByRole("tree")).toBeDefined();
});

