import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "./../testing/fakeApp";
import { agent } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

const started = async () => {
  const app = createFakeApp();

  app.opened.project = { name: "payments-api", path: "/repos/payments-api" };
  app.handlers["rail.tree"] = () => [agent("a", "working", "x", { name: "scout" }), agent("b", "done", "x", { name: "mason" })];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByRole("tab", { name: "payments-api" });
  await screen.findByText("mason");

  return app;
};

const selectedIndex = () => screen.getAllByRole("treeitem").findIndex(row => row.getAttribute("aria-selected") === "true");

it("u5232e_a_click_selects_the_agent_and_shows_its_terminal", async () => {
  const app = await started();

  app.clickStateAlert("a");
  await waitFor(() => expect(selectedIndex()).toBeGreaterThanOrEqual(0));
  const first = selectedIndex();

  app.clickStateAlert("b");

  await waitFor(() => expect(selectedIndex()).toBe(first + 1));
});

it("u5232e_a_click_for_a_gone_agent_shows_the_failure_line", async () => {
  const app = await started();

  app.clickStateAlert("nobody");

  await screen.findByText("That is gone");
});
