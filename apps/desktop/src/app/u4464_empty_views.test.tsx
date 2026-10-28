import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { seedApp } from "../testing/seeds";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";

afterEach(cleanup);

it("u4464_choose_folder_is_a_primary_button_that_opens_the_chooser", async () => {
  const app = createFakeApp();
  const choose = vi.spyOn(app, "chooseProjectPath");
  render(() => <App app={app} clock={() => 0} reducedMotion={() => true} />);
  const button = await screen.findByRole("button", { name: "Choose folder…" });
  expect(button.dataset.button).toBe("primary");
  fireEvent.click(button);
  await waitFor(() => expect(choose).toHaveBeenCalledOnce());
});

it("u4464_cmd_o_opens_the_chooser_on_first_run_only", async () => {
  const app = createFakeApp();
  app.chooser.path = "/chosen";
  const choose = vi.spyOn(app, "chooseProjectPath");
  render(() => <App app={app} clock={() => 0} reducedMotion={() => true} />);
  await screen.findByRole("button", { name: "Choose folder…" });
  fireEvent.keyDown(window, { key: "o", code: "KeyO", metaKey: true });
  await screen.findByRole("textbox", { name: "Ask" });
  expect(choose).toHaveBeenCalledOnce();
  fireEvent.keyDown(window, { key: "o", code: "KeyO", metaKey: true });
  expect(choose).toHaveBeenCalledOnce();
});

it("u4464_empty_actions_do_what_the_existing_buttons_do_agent", async () => {
  const { app } = seedApp("empty-project", 0);
  render(() => <App app={app} clock={() => 0} reducedMotion={() => true} />);
  fireEvent.click(await screen.findByRole("button", { name: "New Agent", exact: true }));
  await waitFor(() => expect(app.calls.filter(call => call.method === "agent.spawn")).toHaveLength(1));
});
