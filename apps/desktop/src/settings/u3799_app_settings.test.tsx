import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u3799_the_event_and_cmd_comma_open_app_settings_in_the_center_with_four_groups", async () => {
  render(() => <App app={createFakeApp()} reducedMotion={() => true} clock={Date.now} />);
  await screen.findByRole("button", { name: /Choose/ });
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  const view = await screen.findByRole("region", { name: "Settings" });
  expect(view.closest(".centre")).toBeTruthy();
  expect([...view.querySelectorAll("h3")].map(item => item.textContent)).toEqual(["Agents", "Terminal", "Shortcuts", "Appearance"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(window, { key: ",", code: "Comma", metaKey: true });
  expect(screen.getAllByRole("region", { name: "Settings" })).toHaveLength(1);
});
