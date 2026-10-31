import { copy as appCopy } from "./copy";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";
import { projectMenu } from "../testing/menuProbe";
import { RequestedApp as App } from "../testing/requestedApp";
import { RpcError } from "./seam";

const PROJECT = { name: "payments-api", path: "/Users/me/repos/payments-api" };

const renderApp = (app: FakeApp) => {
  return render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);
};

const region = (name: string) => screen.getByRole("region", { name });

afterEach(cleanup);

describe("u2 first run", () => {
  it("u2_choosing_a_folder_in_the_chooser_opens_it_and_the_strip_names_the_project", async () => {
    const app = createFakeApp();
    app.chooser.path = PROJECT.path;
    renderApp(app);

    fireEvent.click(await screen.findByText("Choose Project…"));

    await waitFor(() => expect(projectMenu.path).toBe(PROJECT.path));
  });

  it("u2_cancelling_the_chooser_leaves_the_first_run_screen", async () => {
    const app = createFakeApp();
    app.chooser.path = null;
    renderApp(app);

    fireEvent.click(await screen.findByText("Choose Project…"));

    expect(await screen.findByText(appCopy.openAFolderToStart)).toBeTruthy();
  });

  it("u2_an_app_that_already_has_a_project_shows_it_without_a_chooser", async () => {
    const app = createFakeApp();
    app.opened.project = PROJECT;
    renderApp(app);

    await waitFor(() => expect(projectMenu.path).toBe(PROJECT.path));
  });



  it("u2_a_failed_project_call_shows_the_message_in_ink", async () => {
    const app = createFakeApp();
    app.projects = () => Promise.reject(new RpcError(-32603, "app is not ready"));
    renderApp(app);

    expect((await screen.findByText("app is not ready")).className).toBe("ink");
  });

  it("u2_a_failed_chooser_shows_the_message_in_ink", async () => {
    const app = createFakeApp();
    app.chooseProjectPath = () => Promise.reject(new Error("the chooser could not open"));
    renderApp(app);

    fireEvent.click(await screen.findByText("Choose Project…"));

    expect((await screen.findByText("the chooser could not open")).className).toBe("ink");
  });

  it("u2_a_failed_open_project_shows_the_message_in_ink_in_place_of_the_prompt", async () => {
    const app = createFakeApp();
    app.chooser.path = "/not/a/dir";
    const failure = new RpcError(-32602, "/not/a/dir is not a directory");
    app.opened.failure = failure;
    renderApp(app);

    fireEvent.click(await screen.findByText("Choose Project…"));

    expect(await screen.findByText(failure.message)).toBeTruthy();
    expect(screen.queryByText(appCopy.openAFolderToStart)).toBeNull();
  });

  it("u2_a_failed_open_project_is_the_only_ink_in_the_window", async () => {
    const app = createFakeApp();
    app.chooser.path = "/not/a/dir";
    app.opened.failure = new RpcError(-32602, "not a directory");
    const { container } = renderApp(app);

    fireEvent.click(await screen.findByText("Choose Project…"));
    await screen.findByText("not a directory");

    expect(container.querySelectorAll(".ink").length).toBe(1);
  });

  it("u3_a_failed_rail_refetch_shows_the_message_in_ink_in_the_centre", async () => {
    const app = createFakeApp();
    app.opened.project = PROJECT;
    renderApp(app);
    await screen.findByRole("tree", { name: "Rail" });
    app.handlers["rail.tree"] = () => Promise.reject(new RpcError(-32603, "daemon is gone"));

    app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });

    expect((await within(region("Centre")).findByText("daemon is gone")).className).toBe("ink");
  });


});
