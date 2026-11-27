import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, it, vi } from "vitest";
import type { Requested } from "@contracts/project/Requested";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";

const FIRST = { name: "payments-api", path: "/Users/me/repos/payments-api" };

const request = (app: FakeApp, data: Requested) => {
  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "project.requested", data });
};

const started = async () => {
  const app = createFakeApp();

  app.opened.project = FIRST;

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);
  await within(await screen.findByLabelText("Projects", { selector: '[role="tablist"]' })).findByRole("tab", { name: FIRST.name });
  await screen.findByLabelText("Create", { selector: "button" });

  return app;
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("m8 an Agent opens and renames Projects", () => {
  it("m8_a_requested_rename_calls_rename_project", async () => {
    const app = await started();

    request(app, { kind: "rename", path: FIRST.path, name: "billing" });

    await within(await screen.findByLabelText("Projects", { selector: '[role="tablist"]' })).findByRole("tab", { name: "billing" });
  });
});
