import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Requested } from "@contracts/project/Requested";
import { draftStorage } from "../state/storage";
import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";
import { RpcError } from "./seam";

const FIRST = { name: "payments-api", path: "/Users/me/repos/payments-api" };

const SECOND = "/Users/me/repos/ledger";

const request = (app: FakeApp, data: Requested) => {
  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "project.requested", data });
};

const started = async () => {
  const app = createFakeApp();

  app.opened.project = FIRST;

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);
  await screen.findByRole("tab", { name: FIRST.name });
  await screen.findAllByText(/^(new )?Workstream$/);

  return app;
};

afterEach(cleanup);

describe("m8 an Agent opens and renames Projects", () => {
  it("m8_the_webview_answers_a_requested_open_with_open_project", async () => {
    const app = await started();

    request(app, { kind: "open", path: SECOND });

    await screen.findByRole("tab", { name: "ledger" });
  });

  it("m8_a_failed_open_shows_the_error_line", async () => {
    const app = await started();

    app.opened.failure = new RpcError(-32000, "not a folder");
    request(app, { kind: "open", path: SECOND });

    await screen.findByText(/not a folder/);
  });

  it("m8_a_requested_rename_calls_rename_project", async () => {
    const app = await started();

    request(app, { kind: "rename", path: FIRST.path, name: "billing" });

    await screen.findByRole("tab", { name: "billing" });
  });
});


it("u2773a_orders_restores_exact_work", async () => {
  const holder = draftStorage(FIRST.path);
  const exact = "  Order e\u0301 🪁\nlast line  ";
  holder.edit({ surface: "orders", object: "removed-agent", recipient: "removed-agent" }, { ask: exact, title: "Same name", done: "" }, { start: 2, end: 5, direction: "forward" }, "ordinary");
  await started();
  fireEvent.click(await screen.findByRole("button", { name: "Recover unfinished work" }));
  expect(await screen.findByRole("region", { name: "Unfinished work" })).toBeTruthy();
  expect(screen.getByText(exact, { exact: true, normalizer: (text) => text })).toBeTruthy();
  expect(screen.getByText("removed-agent", { exact: false })).toBeTruthy();
  window.localStorage.clear();
});
