import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AppSettings } from "./AppSettings";
import { createFakeApp } from "../testing/fakeApp";
import { RpcError } from "../app/seam";
import { ToastHost } from "../testing/toastHost";

afterEach(() => { cleanup(); localStorage.clear(); });

const open = async (project: string | null) => {
  const app = createFakeApp();
  // The App rejects a Project call with a blank path, as its routing does; naming is the App's own and needs none.
  app.handlers["shortcuts.export"] = () => { throw new RpcError(-32009, "Open a Project first"); };
  render(() => <ToastHost><AppSettings app={app} project={() => project} /></ToastHost>);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("tabpanel");

  return app;
};

it("a7505a_settings_agents_group_has_no_skill_switch", async () => {
  await open(null);
  expect(screen.queryByRole("switch", { name: /Claude Code/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
});

it("a7505c_settings_shows_no_error_without_a_project", async () => {
  const app = await open(null);
  fireEvent.click(await screen.findByRole("tab", { name: "Shortcuts" }));
  expect(await screen.findByText("Open a Project first")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save to file…" }).getAttribute("aria-disabled")).toBe("true");
  // The live-region announcer is always mounted and empty; an error is an alert with text.
  expect(screen.queryAllByRole("alert").filter(alert => alert.textContent?.trim())).toEqual([]);
  expect(app.calls.map(call => call.method)).not.toContain("shortcuts.export");
});
