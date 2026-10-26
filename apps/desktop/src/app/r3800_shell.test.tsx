import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { node } from "../testing/nodes";

afterEach(cleanup);

it.each(["initial open", "reopen"])("r3800_shell_needs_at_most_one_rpc_reply: %s", async mode => {
  const app = createFakeApp();
  app.opened.project = { name: "payments-api", path: "/work/payments-api" };
  app.handlers["rail.tree"] = () => [node("seeded", { name: "Seeded Agent" })];
  const rpc = app.rpc;
  const subscribe = app.subscribe;
  const pending: (() => void)[] = [];
  let holding = mode === "initial open";
  let completed = 0;
  const reply = async () => {
    if (holding) await new Promise<void>(resolve => pending.push(resolve));
    completed++;
  };
  app.rpc = async (method, params) => { await reply(); return rpc(method, params); };
  app.subscribe = async (...args) => { await reply(); return subscribe(...args); };
  const projects = app.projects;
  app.projects = async () => { completed++; return projects(); };
  const open = app.openProject;
  app.openProject = async path => { completed++; return open(path); };

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);

  if (mode === "reopen") {
    await screen.findByText("Seeded Agent");
    holding = true;
    completed = 0;
    app.exitDaemon({ code: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  }

  const rail = await screen.findByRole("region", { name: "Rail" });
  const centre = screen.getByRole("region", { name: "Centre" });
  expect(screen.getByRole("tab", { name: /payments-api/ })).toBeTruthy();
  if (mode === "initial open") {
    expect(within(rail).getByRole("status").textContent).toBe("Loading Project…");
    expect(within(centre).getByRole("status").textContent).toBe("Loading Project…");
  }
  expect(completed).toBeLessThanOrEqual(1);
  expect(pending.length).toBeGreaterThan(0);

  holding = false;
  for (const resolve of pending) resolve();
  await screen.findByText("Seeded Agent");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull());
  fireEvent.click(screen.getByText("Seeded Agent"));
  expect(rail.querySelector('[aria-selected="true"]')).toBeTruthy();
});
