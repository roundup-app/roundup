import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { RequestedApp } from "../testing/requestedApp";
import { RpcError } from "./seam";

afterEach(cleanup);

it("u52_recent_folder_activation_opens_exactly_the_chosen_path", async () => {
  const app = createFakeApp();
  app.recentProjects = async () => ["/repos/one", "/repos/two"];
  const open = vi.spyOn(app, "openProject");
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} />);
  fireEvent.click(await screen.findByRole("button", { name: "/repos/two" }));
  await waitFor(() => expect(open.mock.calls).toEqual([["/repos/two"]]));
});

it("u52_missing_binary_and_failed_recent_open_keep_both_failures_visible", async () => {
  const app = createFakeApp();
  app.recentProjects = async () => ["/repos/one"];
  app.claudeBinary = async () => null;
  app.opened.failure = new RpcError(-32603, "Folder unavailable; choose another folder");
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} />);
  expect(await screen.findByText(/CLAUDE NOT FOUND/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "/repos/one" }));
  expect(await screen.findByText("Folder unavailable; choose another folder")).toBeTruthy();
  expect(screen.getByText(/CLAUDE NOT FOUND/)).toBeTruthy();
});

it("u52_empty_recents_omit_the_list_and_show_the_returned_binary", async () => {
  const app = createFakeApp();
  app.recentProjects = async () => [];
  app.claudeBinary = async () => ({ path: "/fake/claude", version: "9.8.7" });
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} />);
  expect(await screen.findByText(/claude 9.8.7/)).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Recent folders" })).toBeNull();
});
