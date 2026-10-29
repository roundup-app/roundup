// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "./requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "./fakeApp";
import { agent, event, workstream } from "./nodes";
import { rowStatusLabel } from "./rowTip";

afterEach(cleanup);

// The real creator/Stop-hook join and Todo mutations remain in rup's
// a33_completing_the_blocker_reads_idle; this observes the App consuming Status.
it("a33_the_row_reads_blocked_with_its_waits_on_line_then_idle_when_the_blocker_completes", async () => {
  const app = createFakeApp();

  app.opened.project = { name: "project", path: "/project" };
  const blocked = agent("worker", "blocked", "waits on #1", { parent: "home" });

  app.handlers["rail.tree"] = () => [workstream("home"), blocked];
  render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  const rail = await screen.findByRole("region", { name: "Rail" });
  const row = await waitFor(() => {
    const found = rail.querySelector<HTMLElement>(`[data-id="${blocked.id}"]`);

    if (!found) throw new Error("the blocked Agent row has not arrived");

    return found;
  });

  expect(row.getAttribute("data-kind")).toBe(blocked.status!.kind);
  const blockedName = within(row).getByRole("img", { name: /.+/ }).getAttribute("aria-label");
  expect(await rowStatusLabel(row)).toBe(blocked.status!.label);

  const idle = agent(blocked.id, "idle", "ready", { parent: "home", status_revision: "2" });

  app.handlers["rail.tree"] = () => [workstream("home"), idle];
  app.emit(event({ name: "agent.status", data: { id: idle.id, attempt: idle.attempt!, status_revision: idle.status_revision!, status: idle.status! } }));
  await waitFor(() => {
    expect(row.getAttribute("data-kind")).toBe(idle.status!.kind);
    expect(within(row).getByRole("img", { name: /.+/ }).getAttribute("aria-label")).not.toBe(blockedName);
  });
});
