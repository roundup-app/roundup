import { fakeEmulators } from "../terminal/paneHarness";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { seedApp } from "../testing/seeds";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";

afterEach(cleanup);

it("u4464_choose_folder_opens_the_chooser", async () => {
  const app = createFakeApp();
  const choose = vi.spyOn(app, "chooseProjectPath");
  render(() => <App app={app} clock={() => 0} reducedMotion={() => true} createEmulator={fakeEmulators().factory} />);
  const button = await screen.findByRole("button", { name: "Choose Project…" });
  fireEvent.click(button);
  await waitFor(() => expect(choose).toHaveBeenCalledOnce());
});

it("u4464_cmd_o_opens_the_chooser_on_first_run_only", async () => {
  const app = createFakeApp();
  app.chooser.path = "/chosen";
  const choose = vi.spyOn(app, "chooseProjectPath");
  render(() => <App app={app} clock={() => 0} reducedMotion={() => true} createEmulator={fakeEmulators().factory} />);
  await screen.findByRole("button", { name: "Choose Project…" });
  fireEvent.keyDown(window, { key: "o", code: "KeyO", metaKey: true });
  await screen.findByRole("textbox", { name: "Ask" });
  expect(choose).toHaveBeenCalledOnce();
  fireEvent.keyDown(window, { key: "o", code: "KeyO", metaKey: true });
  expect(choose).toHaveBeenCalledOnce();
});

// U4644's parameterized empty-Rail test covers the retired Agent-button duplicate.
it("u4464_no_empty_view_before_the_first_answer_rail", async () => {
  const { app } = seedApp("empty-project", 0);
  const answer = Promise.withResolvers<[]>();
  app.handlers["rail.tree"] = () => answer.promise;
  render(() => <App app={app} clock={() => 0} reducedMotion={() => true} createEmulator={fakeEmulators().factory} />);
  await waitFor(() => expect(app.calls.some(call => call.method === "rail.tree")).toBe(true));
  expect(screen.queryByRole("group", { name: /No Agents/ })).toBeNull();
  answer.resolve([]);
  await screen.findByRole("group", { name: /No Agents/ });
});
