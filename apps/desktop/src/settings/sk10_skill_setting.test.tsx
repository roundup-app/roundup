import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { AppSettings } from "./AppSettings";
import { createFakeApp } from "../testing/fakeApp";
import { RpcError } from "../app/seam";

afterEach(() => { cleanup(); localStorage.clear(); });

const label = "Teach other Claude Code sessions about roundup";

const items = (skill: string, hook = skill) => ({ items: [{ item: "skill", state: skill, path: "/c/skills/roundup/SKILL.md" }, { item: "hook", state: hook, path: "/c/settings.json" }] });

const mount = async (files: { state: ReturnType<typeof items> }, tweak: (app: ReturnType<typeof createFakeApp>) => void = () => {}) => {
  const app = createFakeApp();
  app.handlers["skill.status"] = () => files.state;
  app.handlers["skill.setup"] = () => { files.state = items("current");

 return items("installed"); };

  app.handlers["skill.remove"] = () => { files.state = items("missing");

 return items("removed"); };

  tweak(app);
  render(() => <AppSettings app={app} project={() => null} />);
  await Promise.resolve();
  window.dispatchEvent(new Event("open-app-settings"));
  await screen.findByRole("switch", { name: label });

  return app;
};

const count = (app: ReturnType<typeof createFakeApp>, method: string) => app.calls.filter(call => call.method === method).length;

it("sk10_the_switch_calls_setup_and_remove_once_each_and_shows_the_result", async () => {
  const app = await mount({ state: items("missing") });
  const toggle = screen.getByRole("switch", { name: label });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await screen.findByText("Not installed");
  fireEvent.click(toggle);
  await screen.findByText("Up to date");
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(count(app, "skill.setup")).toBe(1);
  fireEvent.click(toggle);
  await screen.findByText("Not installed");
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(count(app, "skill.setup")).toBe(1);
  expect(count(app, "skill.remove")).toBe(1);
});

it("sk10_update_calls_setup_and_nothing_installs_on_open", async () => {
  const files = { state: items("outdated") };
  const app = await mount(files);
  expect(screen.getByRole("switch", { name: label }).getAttribute("aria-checked")).toBe("true");
  await screen.findByText("Out of date");
  expect(count(app, "skill.setup") + count(app, "skill.remove")).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  await screen.findByText("Up to date");
  expect(count(app, "skill.setup")).toBe(1);
});

it("sk11_a_refused_setup_shows_cause_and_fix_and_the_switch_returns", async () => {
  const files = { state: items("missing", "missing") };

  const app = await mount(files, fake => {
    fake.handlers["skill.setup"] = () => { files.state = items("foreign", "missing");

 return items("foreign", "missing"); };
  });

  const toggle = screen.getByRole("switch", { name: label });
  fireEvent.click(toggle);
  await screen.findByText(/roundup skill is there that roundup did not install/);
  expect(screen.getByText(/rup skill setup --force/)).toBeTruthy();
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(app.calls.some(call => call.method === "skill.remove")).toBe(false);
});

it("sk11_a_cause_is_rendered_as_text", async () => {
  const path = `/home/<b id="injected">x</b>/${"a".repeat(300)}`;
  const files = { state: items("missing") };
  await mount(files, fake => {
    fake.handlers["skill.setup"] = () => { throw new RpcError(-32603, `${path}: Permission denied`); };
  });
  fireEvent.click(screen.getByRole("switch", { name: label }));
  const cause = await screen.findByText(`${path}: Permission denied`);
  expect(cause.querySelector("b")).toBeNull();
  expect(document.getElementById("injected")).toBeNull();
  expect(screen.getByText(/writable/)).toBeTruthy();
  expect(screen.getByRole("switch", { name: label }).getAttribute("aria-checked")).toBe("false");
});
