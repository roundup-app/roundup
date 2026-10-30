// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { RequestedApp as App } from "./requestedApp";
import { mountApp, openWorkProgress, select } from "./appFixture";
import { fakeEmulators } from "../terminal/paneHarness";
import { progressSeed } from "./progressSeed";

it("u3078i_reopen_keeps_an_accepted_resume_read_only", async () => {
  const seed = progressSeed({ project: "/p", agent: "a" });
  let accepted = false;
  const { app } = await mountApp(fake => {
    fake.handlers["message.progress"] = () => seed.progress;
    fake.handlers["message.reconcileWork"] = () => accepted
      ? { ...seed.plan, actions: [{ ...seed.action, decision: "decided" }] }
      : seed.plan;
    // Input from the Daemon: durable decisions and single-successor delivery are proved in Rust.
    fake.handlers["message.resumeWork"] = () => {
      accepted = true;

      return {
        decision: { id: "decided", request: "request", actions: [seed.action.id], message: 7 },
        reconciliation: { ...seed.plan, actions: [{ ...seed.action, decision: "decided" }] },
      };
    };
  });
  const writes = () => app.calls.filter(call => ["message.send", "message.resumeWork", "agent.spawn", "agent.resume", "agent.setOrder", "terminal.write"].includes(call.method));

  select("alpha");
  await openWorkProgress(app);
  const first = within(await screen.findByRole("region", { name: "Progress" }));

  // Unknown effects retain the original report and its prescribed next action.
  await first.findByText(seed.progress.results.find(result => result.report.request.state === "unknown-effect")!.report.request.result);
  await first.findByText(seed.plan.blocked[0]!.action);
  expect(writes()).toEqual([]);
  fireEvent.click(first.getByRole("button", { name: "Resume unfinished work" }));
  await first.findByRole("status");
  expect(writes()).toEqual([{
    method: "message.resumeWork",
    params: expect.objectContaining({ project: "/p", id: "a", action: seed.action.id }),
  }]);

  // A fresh App reads the accepted decision through the same visible user path.
  cleanup();
  const before = [...writes()];
  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="a"]')).not.toBeNull());
  select("alpha");
  await openWorkProgress(app);
  const again = within(await screen.findByRole("region", { name: "Progress" }));

  await again.findByText(seed.plan.blocked[0]!.action);
  expect(again.queryByRole("button", { name: /Resume unfinished|resuming/ })).toBeNull();
  expect(writes()).toEqual(before);
}, 60_000);
