import { copy as appCopy } from "./copy";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { RequestedApp } from "../testing/requestedApp";
import { seedApp } from "../testing/seeds";
import { RpcError } from "./seam";

afterEach(cleanup);

it("u4464_a_recent_folder_opens_that_project_u52_caps_the_list_at_five", async () => {
  const { app } = seedApp("first-run-five", 0);
  app.recentProjects = async () => ["/repos/payments-api", "/repos/two", "/repos/three", "/repos/four", "/repos/five", "/repos/six"];
  const open = vi.spyOn(app, "openProject");
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} />);
  expect(within(await screen.findByRole("list")).getAllByRole("button")).toHaveLength(5);
  fireEvent.click(await screen.findByRole("button", { name: "/repos/payments-api" }));
  await waitFor(() => expect(open.mock.calls).toEqual([["/repos/payments-api"]]));
});

it("u52_missing_binary_and_failed_recent_open_keep_both_failures_visible", async () => {
  const app = createFakeApp();
  app.recentProjects = async () => ["/repos/one"];
  app.claudeBinary = async () => null;
  const failure = new RpcError(-32603, "Folder unavailable; choose another folder");
  app.opened.failure = failure;
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} />);
  await screen.findByText(appCopy.claudeNotFound);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.click(await screen.findByRole("button", { name: "/repos/one" }));
  expect(await screen.findByText(failure.message)).toBeTruthy();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
});

it("u52_empty_recents_omit_the_list_and_show_the_returned_binary", async () => {
  const { app } = seedApp("first-run", 0);
  app.claudeBinary = async () => ({ path: "/fake/claude", version: "9.8.7" });
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} />);
  expect(await screen.findByText(/claude 9.8.7/)).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});
